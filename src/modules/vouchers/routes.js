const express = require('express');
const { z } = require('zod');
const { validate } = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { conflict } = require('../../lib/errors');

const isoDate = z.string().datetime({ offset: true }).transform((v) => new Date(v).toISOString());

module.exports = (db) => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin'));

  router.get('/', async (req, res) => {
    res.json({ data: await db('vouchers').orderBy('id', 'desc') });
  });

  router.post(
    '/',
    validate({
      body: z
        .object({
          code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,40}$/),
          type: z.enum(['percentage', 'fixed']),
          value: z.number().int().positive(),
          max_discount: z.number().int().positive().nullable().default(null),
          min_spend: z.number().int().min(0).default(0),
          quota: z.number().int().positive(),
          starts_at: isoDate,
          ends_at: isoDate,
        })
        .refine((v) => v.type !== 'percentage' || v.value <= 100, { message: 'Percentage must be 1-100', path: ['value'] })
        .refine((v) => v.ends_at > v.starts_at, { message: 'ends_at must be after starts_at', path: ['ends_at'] }),
    }),
    async (req, res) => {
      const body = req.input.body;
      if (await db('vouchers').where({ code: body.code }).first('id')) {
        throw conflict('voucher_exists', `Voucher ${body.code} already exists`);
      }
      const [{ id }] = await db('vouchers').insert(body).returning('id');
      res.status(201).json({ data: await db('vouchers').where({ id }).first() });
    },
  );

  return router;
};
