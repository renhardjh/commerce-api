const express = require('express');
const { z } = require('zod');
const { validate } = require('../../middleware/validate');
const { notFound, conflict } = require('../../lib/errors');
const { loadCart } = require('./service');

const MAX_QUANTITY_PER_ITEM = 50;

module.exports = (db) => {
  const router = express.Router();
  const productParam = { productId: z.coerce.number().int().positive() };

  router.get('/', async (req, res) => {
    res.json({ data: await loadCart(db, req.user.id) });
  });

  router.put(
    '/items/:productId',
    validate({
      params: productParam,
      body: { quantity: z.number().int().min(0).max(MAX_QUANTITY_PER_ITEM) },
    }),
    async (req, res) => {
      const { productId } = req.input.params;
      const { quantity } = req.input.body;
      const userId = req.user.id;

      if (quantity === 0) {
        await db('cart_items').where({ user_id: userId, product_id: productId }).del();
        return res.json({ data: await loadCart(db, userId) });
      }

      const product = await db('products').where({ id: productId, is_active: true }).first('id', 'stock');
      if (!product) throw notFound('Product');
      if (product.stock < quantity) {
        throw conflict('insufficient_stock', `Only ${product.stock} left in stock`, { available: product.stock });
      }

      await db('cart_items')
        .insert({ user_id: userId, product_id: productId, quantity })
        .onConflict(['user_id', 'product_id'])
        .merge({ quantity, updated_at: db.fn.now() });

      return res.json({ data: await loadCart(db, userId) });
    },
  );

  router.delete('/items/:productId', validate({ params: productParam }), async (req, res) => {
    await db('cart_items').where({ user_id: req.user.id, product_id: req.input.params.productId }).del();
    res.json({ data: await loadCart(db, req.user.id) });
  });

  router.delete('/', async (req, res) => {
    await db('cart_items').where({ user_id: req.user.id }).del();
    res.status(204).end();
  });

  return router;
};
