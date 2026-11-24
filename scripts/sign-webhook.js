const config = require('../src/config');
const { sign } = require('../src/modules/payments/signature');

const [orderId, grossAmount, transactionStatus = 'settlement'] = process.argv.slice(2);

if (!orderId || !grossAmount) {
  console.error('usage: npm run sign-webhook -- <order-number> <gross-amount> [settlement|expire|cancel|deny]');
  process.exit(1);
}

const notification = {
  order_id: orderId,
  status_code: transactionStatus === 'settlement' ? '200' : '202',
  gross_amount: Number(grossAmount).toFixed(2),
  transaction_id: `trx-${Date.now()}`,
  transaction_status: transactionStatus,
  payment_type: 'bank_transfer',
};
notification.signature_key = sign(notification, config.payment.serverKey);

console.log(JSON.stringify(notification));
