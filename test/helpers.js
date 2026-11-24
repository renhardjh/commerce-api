const pino = require('pino');
const request = require('supertest');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');

async function setup() {
  const db = createDb('test');
  await db.migrate.latest();
  await db.seed.run();
  const app = createApp({ db, logger: pino({ level: 'silent' }) });
  const api = request(app);

  const login = async (email, password = 'password123') => {
    const res = await api.post('/api/auth/login').send({ email, password }).expect(200);
    return `Bearer ${res.body.token}`;
  };

  const register = async (email) => {
    const res = await api.post('/api/auth/register').send({ name: 'Test Buyer', email, password: 'password123' }).expect(201);
    return `Bearer ${res.body.token}`;
  };

  const product = (sku) => db('products').where({ sku }).first();

  return { db, app, api, login, register, product, teardown: () => db.destroy() };
}

const address = {
  recipient: 'Budi Santoso',
  phone: '081234567890',
  line1: 'Jl. Imam Bonjol No. 10, Karawaci',
  city: 'Tangerang',
  province: 'Banten',
  postal_code: '15115',
};

module.exports = { setup, address };
