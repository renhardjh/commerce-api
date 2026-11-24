const express = require('express');
const { z } = require('zod');
const { validate } = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { paginationSchema, paginate } = require('../../lib/pagination');
const { notFound, conflict } = require('../../lib/errors');
const { slugify } = require('../../lib/slug');

const sorts = {
  newest: ['products.id', 'desc'],
  price_asc: ['products.price', 'asc'],
  price_desc: ['products.price', 'desc'],
  name: ['products.name', 'asc'],
};

const productColumns = [
  'products.id',
  'products.sku',
  'products.name',
  'products.slug',
  'products.description',
  'products.price',
  'products.stock',
  'products.weight_grams',
  'products.is_active',
  'categories.slug as category',
];

const productBody = {
  category_id: z.number().int().positive().nullable(),
  sku: z.string().trim().min(3).max(40).toUpperCase(),
  name: z.string().trim().min(3).max(160),
  description: z.string().trim().max(5000).nullable(),
  price: z.number().int().positive(),
  stock: z.number().int().min(0),
  weight_grams: z.number().int().min(0),
  is_active: z.boolean(),
};

const toProduct = (row) => row && { ...row, is_active: Boolean(row.is_active) };

module.exports = (db) => {
  const router = express.Router();
  const admin = [requireAuth, requireRole('admin')];

  const findProduct = (where) =>
    db('products')
      .leftJoin('categories', 'categories.id', 'products.category_id')
      .where(where)
      .first(productColumns)
      .then(toProduct);

  router.get('/categories', async (req, res) => {
    const rows = await db('categories')
      .leftJoin('products', function joinActive() {
        this.on('products.category_id', 'categories.id').andOnVal('products.is_active', true);
      })
      .groupBy('categories.id', 'categories.name', 'categories.slug')
      .orderBy('categories.name')
      .select('categories.id', 'categories.name', 'categories.slug')
      .count({ product_count: 'products.id' });
    res.json({ data: rows.map((r) => ({ ...r, product_count: Number(r.product_count) })) });
  });

  router.get(
    '/products',
    validate({
      query: {
        ...paginationSchema,
        q: z.string().trim().max(100).optional(),
        category: z.string().trim().max(100).optional(),
        min_price: z.coerce.number().int().min(0).optional(),
        max_price: z.coerce.number().int().min(0).optional(),
        in_stock: z.enum(['true', 'false']).optional(),
        sort: z.enum(Object.keys(sorts)).default('newest'),
      },
    }),
    async (req, res) => {
      const { q, category, min_price: minPrice, max_price: maxPrice, in_stock: inStock, sort, ...page } = req.input.query;
      const query = db('products')
        .leftJoin('categories', 'categories.id', 'products.category_id')
        .where('products.is_active', true)
        .select(productColumns);

      if (q) {
        const term = `%${q.toLowerCase()}%`;
        query.where((w) => w.whereRaw('lower(products.name) like ?', [term]).orWhereRaw('lower(products.sku) like ?', [term]));
      }
      if (category) query.where('categories.slug', category);
      if (minPrice !== undefined) query.where('products.price', '>=', minPrice);
      if (maxPrice !== undefined) query.where('products.price', '<=', maxPrice);
      if (inStock === 'true') query.where('products.stock', '>', 0);

      const [column, direction] = sorts[sort];
      query.orderBy(column, direction).orderBy('products.id', 'desc');

      const result = await paginate(query, page);
      res.json({ ...result, data: result.data.map(toProduct) });
    },
  );

  router.get('/products/:slug', validate({ params: { slug: z.string().max(180) } }), async (req, res) => {
    const product = await findProduct({ 'products.slug': req.input.params.slug, 'products.is_active': true });
    if (!product) throw notFound('Product');
    res.json({ data: product });
  });

  router.post(
    '/products',
    admin,
    validate({
      body: z.object({
        ...productBody,
        category_id: productBody.category_id.default(null),
        description: productBody.description.default(null),
        weight_grams: productBody.weight_grams.default(0),
        is_active: productBody.is_active.default(true),
      }),
    }),
    async (req, res) => {
      const body = req.input.body;
      const taken = await db('products').where({ sku: body.sku }).first('id');
      if (taken) throw conflict('sku_taken', `SKU ${body.sku} is already used`);

      const slug = await uniqueSlug(db, body.name);
      const [{ id }] = await db('products').insert({ ...body, slug }).returning('id');
      res.status(201).json({ data: await findProduct({ 'products.id': id }) });
    },
  );

  router.patch(
    '/products/:id',
    admin,
    validate({
      params: { id: z.coerce.number().int().positive() },
      body: z.object(productBody).partial().refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
    }),
    async (req, res) => {
      const { id } = req.input.params;
      const changes = req.input.body;
      const current = await db('products').where({ id }).first('id', 'name');
      if (!current) throw notFound('Product');

      if (changes.sku) {
        const taken = await db('products').where({ sku: changes.sku }).whereNot({ id }).first('id');
        if (taken) throw conflict('sku_taken', `SKU ${changes.sku} is already used`);
      }
      if (changes.name && changes.name !== current.name) {
        changes.slug = await uniqueSlug(db, changes.name, id);
      }

      await db('products').where({ id }).update({ ...changes, updated_at: db.fn.now() });
      res.json({ data: await findProduct({ 'products.id': id }) });
    },
  );

  router.delete('/products/:id', admin, validate({ params: { id: z.coerce.number().int().positive() } }), async (req, res) => {
    const updated = await db('products').where({ id: req.input.params.id }).update({ is_active: false, updated_at: db.fn.now() });
    if (!updated) throw notFound('Product');
    res.status(204).end();
  });

  return router;
};

async function uniqueSlug(db, name, ignoreId) {
  const base = slugify(name) || 'product';
  let slug = base;
  for (let n = 2; ; n += 1) {
    const query = db('products').where({ slug });
    if (ignoreId) query.whereNot({ id: ignoreId });
    if (!(await query.first('id'))) return slug;
    slug = `${base}-${n}`;
  }
}
