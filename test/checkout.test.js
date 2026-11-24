const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, address } = require('./helpers');
const { expireStaleOrders } = require('../src/modules/orders/service');

describe('cart and checkout', () => {
  let ctx;
  let budi;
  before(async () => {
    ctx = await setup();
    budi = await ctx.login('budi@commerce.test');
  });
  after(() => ctx.teardown());

  const addToCart = (auth, sku, quantity) =>
    ctx.product(sku).then((p) => ctx.api.put(`/api/cart/items/${p.id}`).set('Authorization', auth).send({ quantity }));

  const checkout = (auth, body = {}, headers = {}) =>
    ctx.api.post('/api/orders').set('Authorization', auth).set(headers).send({ shipping_address: address, ...body });

  it('builds a cart and refuses more than the available stock', async () => {
    const res = await addToCart(budi, 'CF-ACEH-250', 2);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.subtotal, 196000);

    const tooMany = await addToCart(budi, 'BG-GRINDER-HAND', 13);
    assert.equal(tooMany.status, 409);
    assert.equal(tooMany.body.error.code, 'insufficient_stock');

    const outOfStock = await addToCart(budi, 'CF-FLORES-250', 1);
    assert.equal(outOfStock.status, 409);
  });

  it('previews pricing with a voucher', async () => {
    const res = await ctx.api.post('/api/orders/preview').set('Authorization', budi).send({ voucher_code: 'ngopi10' }).expect(200);
    assert.equal(res.body.data.subtotal, 196000);
    assert.equal(res.body.data.discount, 19600);
    assert.equal(res.body.data.shipping_fee, 15000);
    assert.equal(res.body.data.total, 191400);
    assert.equal(res.body.data.voucher_code, 'NGOPI10');
  });

  it('rejects a voucher below minimum spend', async () => {
    const res = await ctx.api.post('/api/orders/preview').set('Authorization', budi).send({ voucher_code: 'HEMAT25K' }).expect(422);
    assert.equal(res.body.error.code, 'voucher_min_spend');
  });

  it('places an order, reserves stock and clears the cart', async () => {
    const before = await ctx.product('CF-ACEH-250');
    const res = await checkout(budi, { voucher_code: 'NGOPI10' }, { 'Idempotency-Key': 'checkout-0001' }).expect(201);

    const order = res.body.data;
    assert.match(order.number, /^ORD-\d{8}-[A-F0-9]{6}$/);
    assert.equal(order.status, 'pending_payment');
    assert.equal(order.total, 191400);
    assert.equal(order.items.length, 1);
    assert.equal(order.history[0].to_status, 'pending_payment');

    const after = await ctx.product('CF-ACEH-250');
    assert.equal(after.stock, before.stock - 2);

    const voucher = await ctx.db('vouchers').where({ code: 'NGOPI10' }).first();
    assert.equal(voucher.used, 1);

    const cart = await ctx.api.get('/api/cart').set('Authorization', budi).expect(200);
    assert.equal(cart.body.data.items.length, 0);

    const replay = await checkout(budi, { voucher_code: 'NGOPI10' }, { 'Idempotency-Key': 'checkout-0001' }).expect(200);
    assert.equal(replay.body.data.number, order.number);
  });

  it('refuses checkout with an empty cart', async () => {
    const res = await checkout(budi).expect(422);
    assert.equal(res.body.error.code, 'cart_empty');
  });

  it('only sells the last unit once when two buyers check out together', async () => {
    const admin = await ctx.login('admin@commerce.test');
    const created = await ctx.api
      .post('/api/products')
      .set('Authorization', admin)
      .send({ sku: 'LTD-001', name: 'Limited Roast 100g', price: 90000, stock: 1 })
      .expect(201);

    const buyers = await Promise.all([ctx.register('one@commerce.test'), ctx.register('two@commerce.test')]);
    for (const auth of buyers) {
      await ctx.api.put(`/api/cart/items/${created.body.data.id}`).set('Authorization', auth).send({ quantity: 1 }).expect(200);
    }

    const results = await Promise.all(buyers.map((auth) => checkout(auth)));
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409]);

    const product = await ctx.product('LTD-001');
    assert.equal(product.stock, 0);
  });

  it('restores stock and voucher quota when the customer cancels', async () => {
    await addToCart(budi, 'BG-SCALE-01', 1);
    const stockBefore = (await ctx.product('BG-SCALE-01')).stock;
    const order = (await checkout(budi, { voucher_code: 'HEMAT25K' }).expect(201)).body.data;
    assert.equal(order.discount, 25000);

    const res = await ctx.api.post(`/api/orders/${order.number}/cancel`).set('Authorization', budi).expect(200);
    assert.equal(res.body.data.status, 'cancelled');
    assert.equal((await ctx.product('BG-SCALE-01')).stock, stockBefore);
    assert.equal((await ctx.db('vouchers').where({ code: 'HEMAT25K' }).first()).used, 0);

    const again = await ctx.api.post(`/api/orders/${order.number}/cancel`).set('Authorization', budi).expect(409);
    assert.equal(again.body.error.code, 'invalid_transition');
  });

  it('expires unpaid orders after the payment window', async () => {
    await addToCart(budi, 'MC-TOTE-01', 3);
    const stockBefore = (await ctx.product('MC-TOTE-01')).stock;
    const order = (await checkout(budi).expect(201)).body.data;
    assert.equal((await ctx.product('MC-TOTE-01')).stock, stockBefore - 3);

    await expireStaleOrders(ctx.db, new Date());
    const pending = await ctx.api.get(`/api/orders/${order.number}`).set('Authorization', budi).expect(200);
    assert.equal(pending.body.data.status, 'pending_payment');

    const later = new Date(Date.now() + 31 * 60_000);
    assert.ok((await expireStaleOrders(ctx.db, later)) >= 1);

    const res = await ctx.api.get(`/api/orders/${order.number}`).set('Authorization', budi).expect(200);
    assert.equal(res.body.data.status, 'expired');
    assert.equal((await ctx.product('MC-TOTE-01')).stock, stockBefore);
  });

  it('hides other customers orders', async () => {
    const list = await ctx.api.get('/api/orders').set('Authorization', budi).expect(200);
    const other = await ctx.register('three@commerce.test');
    await ctx.api.get(`/api/orders/${list.body.data[0].number}`).set('Authorization', other).expect(404);
  });
});
