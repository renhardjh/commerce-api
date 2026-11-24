const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

describe('auth and catalog', () => {
  let ctx;
  before(async () => {
    ctx = await setup();
  });
  after(() => ctx.teardown());

  it('registers a customer and rejects duplicate email', async () => {
    const res = await ctx.api
      .post('/api/auth/register')
      .send({ name: 'Sari', email: 'Sari@Example.com', password: 'secret123' })
      .expect(201);
    assert.equal(res.body.user.email, 'sari@example.com');
    assert.equal(res.body.user.role, 'customer');
    assert.ok(res.body.token);

    const dup = await ctx.api
      .post('/api/auth/register')
      .send({ name: 'Sari', email: 'sari@example.com', password: 'secret123' })
      .expect(409);
    assert.equal(dup.body.error.code, 'email_taken');
  });

  it('rejects a wrong password', async () => {
    await ctx.api.post('/api/auth/login').send({ email: 'budi@commerce.test', password: 'nope' }).expect(401);
  });

  it('returns validation details', async () => {
    const res = await ctx.api.post('/api/auth/register').send({ email: 'bad' }).expect(400);
    const fields = res.body.error.details.map((d) => d.field).sort();
    assert.deepEqual(fields, ['email', 'name', 'password']);
  });

  it('lists products with filters, sorting and pagination', async () => {
    const res = await ctx.api
      .get('/api/products')
      .query({ category: 'coffee', sort: 'price_asc', per_page: 2, in_stock: 'true' })
      .expect(200);
    assert.equal(res.body.meta.total, 4);
    assert.equal(res.body.meta.total_pages, 2);
    assert.deepEqual(
      res.body.data.map((p) => p.sku),
      ['CF-ACEH-250', 'CF-KINTAMANI-250'],
    );
  });

  it('searches by name', async () => {
    const res = await ctx.api.get('/api/products').query({ q: 'kettle' }).expect(200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].slug, 'gooseneck-kettle-600ml');
  });

  it('counts active products per category', async () => {
    const res = await ctx.api.get('/api/categories').expect(200);
    const counts = Object.fromEntries(res.body.data.map((c) => [c.slug, c.product_count]));
    assert.deepEqual(counts, { 'brewing-gear': 5, coffee: 5, merchandise: 2 });
  });

  it('only lets admins manage products', async () => {
    const customer = await ctx.login('budi@commerce.test');
    const admin = await ctx.login('admin@commerce.test');
    const body = { sku: 'cf-papua-250', name: 'Papua Wamena 250g', price: 125000, stock: 10 };

    await ctx.api.post('/api/products').send(body).expect(401);
    await ctx.api.post('/api/products').set('Authorization', customer).send(body).expect(403);

    const created = await ctx.api.post('/api/products').set('Authorization', admin).send(body).expect(201);
    assert.equal(created.body.data.sku, 'CF-PAPUA-250');
    assert.equal(created.body.data.slug, 'papua-wamena-250g');

    const again = await ctx.api.post('/api/products').set('Authorization', admin).send(body).expect(409);
    assert.equal(again.body.error.code, 'sku_taken');

    const updated = await ctx.api
      .patch(`/api/products/${created.body.data.id}`)
      .set('Authorization', admin)
      .send({ price: 130000, name: 'Papua Wamena Natural 250g' })
      .expect(200);
    assert.equal(updated.body.data.price, 130000);
    assert.equal(updated.body.data.slug, 'papua-wamena-natural-250g');

    await ctx.api.delete(`/api/products/${created.body.data.id}`).set('Authorization', admin).expect(204);
    await ctx.api.get('/api/products/papua-wamena-natural-250g').expect(404);
  });
});
