const crypto = require('node:crypto');
const config = require('../../config');
const { conflict, unprocessable, notFound } = require('../../lib/errors');
const { loadCart } = require('../cart/service');
const { findApplicableVoucher } = require('../vouchers/service');

const TRANSITIONS = {
  pending_payment: ['paid', 'cancelled', 'expired'],
  paid: ['shipped'],
  shipped: ['completed'],
  completed: [],
  cancelled: [],
  expired: [],
};

const RELEASES_STOCK = new Set(['cancelled', 'expired']);

const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

function shippingFeeFor(subtotal) {
  return subtotal >= config.shipping.freeMinSubtotal ? 0 : config.shipping.flatFee;
}

function generateOrderNumber(now = new Date()) {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  return `ORD-${day}-${suffix}`;
}

function assertCartReady(cart) {
  if (cart.items.length === 0) {
    throw unprocessable('cart_empty', 'Your cart is empty');
  }
  const problems = cart.items.filter((item) => !item.available);
  if (problems.length > 0) {
    throw conflict(
      'cart_unavailable',
      'Some items in your cart are no longer available',
      problems.map(({ product_id: productId, issue, stock }) => ({ product_id: productId, issue, stock })),
    );
  }
}

async function quote(db, userId, voucherCode, now = new Date()) {
  const cart = await loadCart(db, userId);
  assertCartReady(cart);

  let voucher = null;
  let discount = 0;
  if (voucherCode) {
    ({ voucher, discount } = await findApplicableVoucher(db, voucherCode, cart.subtotal, now));
  }
  const shippingFee = shippingFeeFor(cart.subtotal);

  return {
    cart,
    voucher,
    pricing: {
      subtotal: cart.subtotal,
      discount,
      shipping_fee: shippingFee,
      total: cart.subtotal - discount + shippingFee,
      voucher_code: voucher ? voucher.code : null,
    },
  };
}

async function placeOrder(db, { userId, shippingAddress, voucherCode, idempotencyKey, now = new Date() }) {
  if (idempotencyKey) {
    const existing = await db('orders').where({ user_id: userId, idempotency_key: idempotencyKey }).first('number');
    if (existing) return { order: await getOrder(db, { number: existing.number }), created: false };
  }

  const number = await db.transaction(async (trx) => {
    const { cart, voucher, pricing } = await quote(trx, userId, voucherCode, now);

    for (const item of cart.items) {
      const reserved = await trx('products')
        .where({ id: item.product_id, is_active: true })
        .andWhere('stock', '>=', item.quantity)
        .decrement('stock', item.quantity);
      if (!reserved) {
        throw conflict('insufficient_stock', `${item.name} is out of stock`, { product_id: item.product_id });
      }
    }

    if (voucher) {
      const claimed = await trx('vouchers').where({ id: voucher.id }).andWhere('used', '<', trx.ref('quota')).increment('used', 1);
      if (!claimed) throw unprocessable('voucher_exhausted', 'Voucher quota has run out');
    }

    const orderNumber = generateOrderNumber(now);
    const expiresAt = new Date(now.getTime() + config.orders.paymentTtlMinutes * 60_000).toISOString();
    const [{ id: orderId }] = await trx('orders')
      .insert({
        number: orderNumber,
        user_id: userId,
        status: 'pending_payment',
        subtotal: pricing.subtotal,
        discount: pricing.discount,
        shipping_fee: pricing.shipping_fee,
        total: pricing.total,
        voucher_id: voucher ? voucher.id : null,
        shipping_address: JSON.stringify(shippingAddress),
        idempotency_key: idempotencyKey || null,
        expires_at: expiresAt,
      })
      .returning('id');

    await trx('order_items').insert(
      cart.items.map((item) => ({
        order_id: orderId,
        product_id: item.product_id,
        sku: item.sku,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        line_total: item.line_total,
      })),
    );
    await trx('order_events').insert({ order_id: orderId, from_status: null, to_status: 'pending_payment', actor: `user:${userId}` });
    await trx('cart_items').where({ user_id: userId }).del();
    return orderNumber;
  });

  return { order: await getOrder(db, { number }), created: true };
}

async function transition(trx, order, to, { actor, note, changes = {} }) {
  if (!canTransition(order.status, to)) {
    throw conflict('invalid_transition', `Order cannot move from ${order.status} to ${to}`);
  }
  const updated = await trx('orders')
    .where({ id: order.id, status: order.status })
    .update({ ...changes, status: to, updated_at: trx.fn.now() });
  if (!updated) {
    throw conflict('order_changed', 'Order was updated by another process, please retry');
  }
  await trx('order_events').insert({ order_id: order.id, from_status: order.status, to_status: to, actor, note: note || null });

  if (RELEASES_STOCK.has(to)) {
    const items = await trx('order_items').where({ order_id: order.id }).select('product_id', 'quantity');
    for (const item of items) {
      await trx('products').where({ id: item.product_id }).increment('stock', item.quantity);
    }
    if (order.voucher_id) {
      await trx('vouchers').where({ id: order.voucher_id }).andWhere('used', '>', 0).decrement('used', 1);
    }
  }
}

async function changeStatus(db, number, to, { actor, note, changes, userId } = {}) {
  await db.transaction(async (trx) => {
    const query = trx('orders').where({ number });
    if (userId) query.andWhere({ user_id: userId });
    const order = await query.first();
    if (!order) throw notFound('Order');
    await transition(trx, order, to, { actor, note, changes });
  });
  return getOrder(db, { number });
}

async function expireStaleOrders(db, now = new Date()) {
  const stale = await db('orders')
    .where({ status: 'pending_payment' })
    .andWhere('expires_at', '<', now.toISOString())
    .select('number');

  let expired = 0;
  for (const { number } of stale) {
    try {
      await changeStatus(db, number, 'expired', { actor: 'system', note: 'Payment window elapsed' });
      expired += 1;
    } catch (err) {
      if (err.code !== 'order_changed' && err.code !== 'invalid_transition') throw err;
    }
  }
  return expired;
}

async function getOrder(db, where) {
  const order = await db('orders').where(where).first();
  if (!order) return null;
  const [items, events] = await Promise.all([
    db('order_items').where({ order_id: order.id }).orderBy('id').select('product_id', 'sku', 'name', 'price', 'quantity', 'line_total'),
    db('order_events').where({ order_id: order.id }).orderBy('id').select('from_status', 'to_status', 'actor', 'note', 'created_at'),
  ]);
  return serialize(order, items, events);
}

function serialize(order, items, events) {
  return {
    number: order.number,
    status: order.status,
    subtotal: Number(order.subtotal),
    discount: Number(order.discount),
    shipping_fee: Number(order.shipping_fee),
    total: Number(order.total),
    shipping_address: JSON.parse(order.shipping_address),
    tracking_number: order.tracking_number,
    expires_at: order.expires_at,
    paid_at: order.paid_at,
    created_at: order.created_at,
    ...(items && { items: items.map((i) => ({ ...i, price: Number(i.price), line_total: Number(i.line_total) })) }),
    ...(events && { history: events }),
  };
}

module.exports = {
  TRANSITIONS,
  canTransition,
  shippingFeeFor,
  quote,
  placeOrder,
  transition,
  changeStatus,
  expireStaleOrders,
  getOrder,
  serialize,
};
