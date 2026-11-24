const crypto = require('node:crypto');

function sign({ order_id: orderId, status_code: statusCode, gross_amount: grossAmount }, serverKey) {
  return crypto.createHash('sha512').update(`${orderId}${statusCode}${grossAmount}${serverKey}`).digest('hex');
}

function verify(notification, serverKey) {
  const expected = Buffer.from(sign(notification, serverKey), 'hex');
  const given = Buffer.from(String(notification.signature_key || ''), 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

module.exports = { sign, verify };
