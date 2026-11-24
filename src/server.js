const pino = require('pino');
const config = require('./config');
const { createDb } = require('./db');
const { createApp } = require('./app');
const { expireStaleOrders } = require('./modules/orders/service');

const logger = pino({
  level: config.logLevel,
  redact: ['req.headers.authorization', 'req.headers.cookie'],
});
const db = createDb();
const app = createApp({ db, logger });

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env }, 'commerce-api listening');
});

let sweeping = false;
const sweep = async () => {
  if (sweeping) return;
  sweeping = true;
  try {
    const expired = await expireStaleOrders(db);
    if (expired > 0) logger.info({ expired }, 'expired unpaid orders');
  } catch (err) {
    logger.error({ err }, 'order expiry sweep failed');
  } finally {
    sweeping = false;
  }
};

const timer = config.orders.expirySweepSeconds > 0 ? setInterval(sweep, config.orders.expirySweepSeconds * 1000) : null;

const shutdown = (signal) => {
  logger.info({ signal }, 'shutting down');
  if (timer) clearInterval(timer);
  server.close(async () => {
    await db.destroy();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
