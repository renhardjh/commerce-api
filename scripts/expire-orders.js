const { createDb } = require('../src/db');
const { expireStaleOrders } = require('../src/modules/orders/service');

(async () => {
  const db = createDb();
  try {
    const expired = await expireStaleOrders(db);
    console.log(`expired ${expired} unpaid order(s)`);
  } finally {
    await db.destroy();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
