const express = require('express');
const { z } = require('zod');
const config = require('../../config');
const { validate } = require('../../middleware/validate');
const { unauthorized, notFound, unprocessable } = require('../../lib/errors');
const { transition, canTransition } = require('../orders/service');
const { verify } = require('./signature');

const PROVIDER = 'midtrans';

const notificationSchema = z.looseObject({
  order_id: z.string().min(1),
  status_code: z.string().min(1),
  gross_amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  signature_key: z.string().min(1),
  transaction_id: z.string().min(1),
  transaction_status: z.string().min(1),
  fraud_status: z.string().optional(),
  payment_type: z.string().optional(),
});

function targetStatus({ transaction_status: status, fraud_status: fraud }) {
  switch (status) {
    case 'settlement':
      return 'paid';
    case 'capture':
      return fraud === 'accept' ? 'paid' : null;
    case 'expire':
      return 'expired';
    case 'cancel':
    case 'deny':
      return 'cancelled';
    default:
      return null;
  }
}

module.exports = (db) => {
  const router = express.Router();

  router.post('/notifications', validate({ body: notificationSchema }), async (req, res) => {
    const notification = req.input.body;
    if (!verify(notification, config.payment.serverKey)) {
      throw unauthorized('Invalid signature');
    }

    const result = await db.transaction(async (trx) => {
      const order = await trx('orders').where({ number: notification.order_id }).first();
      if (!order) throw notFound('Order');

      const amount = Math.round(Number(notification.gross_amount));
      if (amount !== Number(order.total)) {
        throw unprocessable('amount_mismatch', 'Paid amount does not match order total', {
          expected: Number(order.total),
          received: amount,
        });
      }

      const inserted = await trx('payments')
        .insert({
          order_id: order.id,
          provider: PROVIDER,
          transaction_id: notification.transaction_id,
          transaction_status: notification.transaction_status,
          amount,
          payload: JSON.stringify(notification),
        })
        .onConflict(['provider', 'transaction_id', 'transaction_status'])
        .ignore()
        .returning('id');
      if (inserted.length === 0) {
        return { result: 'duplicate', status: order.status };
      }

      const target = targetStatus(notification);
      if (!target || target === order.status) {
        return { result: 'recorded', status: order.status };
      }
      if (!canTransition(order.status, target)) {
        req.log.warn({ order: order.number, from: order.status, to: target }, 'payment notification for closed order');
        return { result: 'ignored', status: order.status, reason: `order is ${order.status}` };
      }

      const now = new Date().toISOString();
      await transition(trx, order, target, {
        actor: `payment:${PROVIDER}`,
        note: `${notification.transaction_status} ${notification.transaction_id}`,
        changes: target === 'paid' ? { paid_at: now } : {},
      });
      return { result: 'applied', status: target };
    });

    res.json(result);
  });

  return router;
};
