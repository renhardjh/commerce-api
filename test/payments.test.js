const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { sign } = require('../src/modules/payments/signature');
const { setup, address } = require('./helpers');

describe('payment notifications and fulfilment', () => {
  let ctx;
  let budi;
  let admin;
  before(async () => {
    ctx = await setup();
    budi = await ctx.login('budi@commerce.test');
    admin = await ctx.login('admin@commerce.test');
  });
  after(() => ctx.teardown());

  const placeOrder = async (sku, quantity) => {
    const product = await ctx.product(sku);
    await ctx.api.put(`/api/cart/items/${product.id}`).set('Authorization', budi).send({ quantity }).expect(200);
    const res = await ctx.api.post('/api/orders').set('Authorization', budi).send({ shipping_address: address }).expect(201);
    return res.body.data;
  };

  const notification = (order, overrides = {}) => {
    const body = {
      order_id: order.number,
      status_code: '200',
      gross_amount: `${order.total}.00`,
      transaction_id: `trx-${order.number}`,
      transaction_status: 'settlement',
      payment_type: 'bank_transfer',
      ...overrides,
    };
    return { ...body, signature_key: overrides.signature_key || sign(body, config.payment.serverKey) };
  };

  const notify = (body) => ctx.api.post('/api/payments/notifications').send(body);

  it('rejects a bad signature', async () => {
    const order = await placeOrder('BG-V60-02', 1);
    const res = await notify(notification(order, { signature_key: 'ab'.repeat(64) })).expect(401);
    assert.equal(res.body.error.message, 'Invalid signature');
  });

  it('rejects an amount that does not match the order', async () => {
    const order = await placeOrder('BG-FILTER-100', 2);
    const res = await notify(notification({ ...order, total: order.total - 1000 })).expect(422);
    assert.equal(res.body.error.code, 'amount_mismatch');
  });

  it('marks the order paid once and ignores retries', async () => {
    const order = await placeOrder('MC-TUMBLER-500', 1);

    const first = await notify(notification(order)).expect(200);
    assert.deepEqual(first.body, { result: 'applied', status: 'paid' });

    const retry = await notify(notification(order)).expect(200);
    assert.equal(retry.body.result, 'duplicate');

    const res = await ctx.api.get(`/api/orders/${order.number}`).set('Authorization', budi).expect(200);
    assert.equal(res.body.data.status, 'paid');
    assert.ok(res.body.data.paid_at);
    assert.deepEqual(
      res.body.data.history.map((h) => h.to_status),
      ['pending_payment', 'paid'],
    );

    const count = await ctx.db('payments').count({ n: '*' }).first();
    assert.equal(Number(count.n), 1);
  });

  it('cancels the order and restores stock on a deny notification', async () => {
    const stockBefore = (await ctx.product('BG-KETTLE-600')).stock;
    const order = await placeOrder('BG-KETTLE-600', 2);

    const res = await notify(notification(order, { transaction_status: 'deny', status_code: '202' })).expect(200);
    assert.equal(res.body.status, 'cancelled');
    assert.equal((await ctx.product('BG-KETTLE-600')).stock, stockBefore);
  });

  it('records but does not apply a settlement for an expired order', async () => {
    const order = await placeOrder('CF-TORAJA-250', 1);
    await ctx.db('orders').where({ number: order.number }).update({ status: 'expired' });

    const res = await notify(notification(order)).expect(200);
    assert.equal(res.body.result, 'ignored');
    assert.equal(res.body.status, 'expired');
  });

  it('lets admins ship and complete a paid order', async () => {
    const order = await placeOrder('CF-JAVA-1KG', 2);
    await notify(notification(order)).expect(200);

    const missing = await ctx.api
      .patch(`/api/admin/orders/${order.number}/status`)
      .set('Authorization', admin)
      .send({ status: 'shipped' })
      .expect(400);
    assert.equal(missing.body.error.details[0].field, 'tracking_number');

    await ctx.api
      .patch(`/api/admin/orders/${order.number}/status`)
      .set('Authorization', budi)
      .send({ status: 'shipped', tracking_number: 'JNE1234567890' })
      .expect(403);

    const shipped = await ctx.api
      .patch(`/api/admin/orders/${order.number}/status`)
      .set('Authorization', admin)
      .send({ status: 'shipped', tracking_number: 'JNE1234567890' })
      .expect(200);
    assert.equal(shipped.body.data.tracking_number, 'JNE1234567890');

    const completed = await ctx.api
      .patch(`/api/admin/orders/${order.number}/status`)
      .set('Authorization', admin)
      .send({ status: 'completed' })
      .expect(200);
    assert.equal(completed.body.data.status, 'completed');

    const list = await ctx.api.get('/api/admin/orders').query({ status: 'completed' }).set('Authorization', admin).expect(200);
    assert.equal(list.body.meta.total, 1);
  });
});
