const express = require('express');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const { requireAuth } = require('./middleware/auth');
const { notFoundHandler, errorHandler } = require('./middleware/errors');
const authRoutes = require('./modules/auth/routes');
const catalogRoutes = require('./modules/catalog/routes');
const cartRoutes = require('./modules/cart/routes');
const orderRoutes = require('./modules/orders/routes');
const voucherRoutes = require('./modules/vouchers/routes');
const paymentRoutes = require('./modules/payments/routes');

function createApp({ db, logger }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', async (req, res) => {
    await db.raw('select 1');
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRoutes(db));
  app.use('/api', catalogRoutes(db));
  app.use('/api/cart', requireAuth, cartRoutes(db));
  app.use('/api/orders', requireAuth, orderRoutes.customer(db));
  app.use('/api/admin/orders', requireAuth, orderRoutes.admin(db));
  app.use('/api/admin/vouchers', voucherRoutes(db));
  app.use('/api/payments', paymentRoutes(db));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
