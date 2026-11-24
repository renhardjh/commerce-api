const fs = require('node:fs');
const path = require('node:path');

const envFile = path.resolve(__dirname, '..', '.env');
if (process.env.NODE_ENV !== 'test' && fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
};

const env = process.env.NODE_ENV || 'development';

const config = {
  env,
  port: int(process.env.PORT, 3000),
  logLevel: process.env.LOG_LEVEL || (env === 'test' ? 'silent' : 'info'),
  sqlitePath: process.env.SQLITE_PATH || path.resolve(__dirname, '..', 'data', 'commerce.db'),
  databaseUrl: process.env.DATABASE_URL,
  jwt: {
    secret: process.env.JWT_SECRET || (env === 'production' ? undefined : 'dev-secret'),
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  },
  payment: {
    serverKey: process.env.PAYMENT_SERVER_KEY || 'SB-Mid-server-local',
  },
  orders: {
    paymentTtlMinutes: int(process.env.ORDER_PAYMENT_TTL_MINUTES, 30),
    expirySweepSeconds: int(process.env.ORDER_EXPIRY_SWEEP_SECONDS, 60),
  },
  shipping: {
    flatFee: int(process.env.SHIPPING_FEE, 15000),
    freeMinSubtotal: int(process.env.FREE_SHIPPING_MIN, 500000),
  },
};

if (!config.jwt.secret) {
  throw new Error('JWT_SECRET must be set in production');
}

module.exports = config;
