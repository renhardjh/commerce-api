const express = require('express');
const { z } = require('zod');
const { validate } = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { paginationSchema, paginate } = require('../../lib/pagination');
const { notFound, badRequest } = require('../../lib/errors');
const orders = require('./service');

const STATUSES = Object.keys(orders.TRANSITIONS);

const addressSchema = z.object({
  recipient: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^(\+62|62|0)8[0-9]{7,12}$/, 'Must be an Indonesian mobile number'),
  line1: z.string().trim().min(5).max(255),
  city: z.string().trim().min(2).max(80),
  province: z.string().trim().min(2).max(80),
  postal_code: z.string().trim().regex(/^[0-9]{5}$/),
});

const numberParam = { number: z.string().regex(/^ORD-\d{8}-[A-F0-9]{6}$/) };

const customer = (db) => {
  const router = express.Router();

  router.post('/preview', validate({ body: { voucher_code: z.string().trim().max(40).optional() } }), async (req, res) => {
    const { cart, pricing } = await orders.quote(db, req.user.id, req.input.body.voucher_code);
    res.json({ data: { items: cart.items, ...pricing } });
  });

  router.post(
    '/',
    validate({
      body: {
        shipping_address: addressSchema,
        voucher_code: z.string().trim().max(40).optional(),
      },
    }),
    async (req, res) => {
      const idempotencyKey = req.get('idempotency-key');
      if (idempotencyKey && !/^[A-Za-z0-9_-]{8,80}$/.test(idempotencyKey)) {
        throw badRequest('Idempotency-Key must be 8-80 characters of letters, digits, "-" or "_"');
      }
      const { order, created } = await orders.placeOrder(db, {
        userId: req.user.id,
        shippingAddress: req.input.body.shipping_address,
        voucherCode: req.input.body.voucher_code,
        idempotencyKey,
      });
      res.status(created ? 201 : 200).json({ data: order });
    },
  );

  router.get(
    '/',
    validate({ query: { ...paginationSchema, status: z.enum(STATUSES).optional() } }),
    async (req, res) => {
      const { status, ...page } = req.input.query;
      const query = db('orders').where({ user_id: req.user.id }).orderBy('id', 'desc');
      if (status) query.andWhere({ status });
      const result = await paginate(query, page);
      res.json({ ...result, data: result.data.map((o) => orders.serialize(o)) });
    },
  );

  router.get('/:number', validate({ params: numberParam }), async (req, res) => {
    const order = await orders.getOrder(db, { number: req.input.params.number, user_id: req.user.id });
    if (!order) throw notFound('Order');
    res.json({ data: order });
  });

  router.post('/:number/cancel', validate({ params: numberParam }), async (req, res) => {
    const order = await orders.changeStatus(db, req.input.params.number, 'cancelled', {
      actor: `user:${req.user.id}`,
      note: 'Cancelled by customer',
      userId: req.user.id,
    });
    res.json({ data: order });
  });

  return router;
};

const admin = (db) => {
  const router = express.Router();
  router.use(requireRole('admin'));

  router.get(
    '/',
    validate({ query: { ...paginationSchema, status: z.enum(STATUSES).optional() } }),
    async (req, res) => {
      const { status, ...page } = req.input.query;
      const query = db('orders').orderBy('id', 'desc');
      if (status) query.where({ status });
      const result = await paginate(query, page);
      res.json({ ...result, data: result.data.map((o) => orders.serialize(o)) });
    },
  );

  router.patch(
    '/:number/status',
    validate({
      params: numberParam,
      body: z
        .object({
          status: z.enum(['shipped', 'completed', 'cancelled']),
          tracking_number: z.string().trim().min(6).max(60).optional(),
          note: z.string().trim().max(255).optional(),
        })
        .refine((b) => b.status !== 'shipped' || b.tracking_number, {
          message: 'tracking_number is required when shipping',
          path: ['tracking_number'],
        }),
    }),
    async (req, res) => {
      const { status, tracking_number: trackingNumber, note } = req.input.body;
      const order = await orders.changeStatus(db, req.input.params.number, status, {
        actor: `admin:${req.user.id}`,
        note,
        changes: trackingNumber ? { tracking_number: trackingNumber } : {},
      });
      res.json({ data: order });
    },
  );

  return router;
};

module.exports = { customer, admin };
