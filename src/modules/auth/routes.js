const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { validate } = require('../../middleware/validate');
const { signToken, requireAuth } = require('../../middleware/auth');
const { conflict, unauthorized, notFound } = require('../../lib/errors');

const publicUser = ({ id, name, email, role, created_at: createdAt }) => ({ id, name, email, role, created_at: createdAt });

module.exports = (db) => {
  const router = express.Router();

  router.post(
    '/register',
    validate({
      body: {
        name: z.string().trim().min(2).max(120),
        email: z.string().trim().toLowerCase().email(),
        password: z.string().min(8).max(72),
      },
    }),
    async (req, res) => {
      const { name, email, password } = req.input.body;
      const exists = await db('users').where({ email }).first('id');
      if (exists) throw conflict('email_taken', 'An account with this email already exists');

      const passwordHash = await bcrypt.hash(password, 10);
      const [{ id }] = await db('users').insert({ name, email, password_hash: passwordHash, role: 'customer' }).returning('id');
      const user = await db('users').where({ id }).first();
      res.status(201).json({ token: signToken(user), user: publicUser(user) });
    },
  );

  router.post(
    '/login',
    validate({
      body: {
        email: z.string().trim().toLowerCase().email(),
        password: z.string().min(1),
      },
    }),
    async (req, res) => {
      const { email, password } = req.input.body;
      const user = await db('users').where({ email }).first();
      const ok = user && (await bcrypt.compare(password, user.password_hash));
      if (!ok) throw unauthorized('Email or password is incorrect');
      res.json({ token: signToken(user), user: publicUser(user) });
    },
  );

  router.get('/me', requireAuth, async (req, res) => {
    const user = await db('users').where({ id: req.user.id }).first();
    if (!user) throw notFound('User');
    res.json({ user: publicUser(user) });
  });

  return router;
};
