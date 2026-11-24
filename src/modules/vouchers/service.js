const { unprocessable } = require('../../lib/errors');

function calculateDiscount(voucher, subtotal) {
  if (voucher.type === 'fixed') {
    return Math.min(Number(voucher.value), subtotal);
  }
  const raw = Math.floor((subtotal * Number(voucher.value)) / 100);
  const capped = voucher.max_discount == null ? raw : Math.min(raw, Number(voucher.max_discount));
  return Math.min(capped, subtotal);
}

async function findApplicableVoucher(db, code, subtotal, now = new Date()) {
  const voucher = await db('vouchers').whereRaw('upper(code) = ?', [code.trim().toUpperCase()]).first();
  if (!voucher || !voucher.is_active) {
    throw unprocessable('voucher_invalid', 'Voucher code is not valid');
  }
  const iso = now.toISOString();
  if (iso < voucher.starts_at || iso > voucher.ends_at) {
    throw unprocessable('voucher_expired', 'Voucher is not active at this time');
  }
  if (voucher.used >= voucher.quota) {
    throw unprocessable('voucher_exhausted', 'Voucher quota has run out');
  }
  if (subtotal < Number(voucher.min_spend)) {
    throw unprocessable('voucher_min_spend', `Minimum spend for this voucher is ${voucher.min_spend}`, {
      min_spend: Number(voucher.min_spend),
    });
  }
  return { voucher, discount: calculateDiscount(voucher, subtotal) };
}

module.exports = { calculateDiscount, findApplicableVoucher };
