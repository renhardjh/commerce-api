# commerce-api

Backend for an online store: catalog, cart, checkout, vouchers, payment notifications and order fulfilment. Node.js, Express 5 and Knex.

I built the first version of this kind of backend at PT Solveway Dashindo Teknologi for an e-commerce mobile app. That code is not mine to publish, so this repository is a fresh rewrite of the same design with current libraries, demo products and a full test suite.

## What it covers

- **Accounts**: register, login, JWT auth, `customer` and `admin` roles.
- **Catalog**: categories, products with search, category and price filters, sorting and pagination. Admin create, update and soft delete.
- **Cart**: one cart per user, quantity checks against live stock, items flagged when they go out of stock.
- **Checkout**: runs in one database transaction. Stock is reserved with a conditional `UPDATE ... WHERE stock >= qty`, so two buyers cannot both get the last unit. Supports an `Idempotency-Key` header so a retried request from the app does not create a second order.
- **Vouchers**: percentage (with a cap) or fixed amount, minimum spend, validity window and quota. Quota is claimed atomically at checkout and released if the order is cancelled or expires.
- **Orders**: explicit state machine with a history table.

  ```
  pending_payment -> paid -> shipped -> completed
  pending_payment -> cancelled | expired
  ```

  Cancelled and expired orders return their stock and voucher quota. Every transition checks the current status in the `WHERE` clause, so a payment callback and a cancel arriving at the same time cannot both win.
- **Payments**: Midtrans-style HTTP notification endpoint. Verifies the SHA-512 signature, checks the amount against the order total, stores every notification once (retries are acknowledged but not re-applied), then moves the order to `paid`, `cancelled` or `expired`.
- **Expiry**: unpaid orders expire after `ORDER_PAYMENT_TTL_MINUTES`. The server sweeps on an interval, and `npm run expire-orders` does a one-off run for cron.

Money is stored as integer rupiah.

## Running locally

Requires Node.js 20.12 or newer. Uses SQLite by default, so nothing else needs to be installed.

```bash
npm install
cp .env.example .env
npm run setup
npm run dev
```

Seeded accounts (password `password123`):

| Email | Role |
|---|---|
| admin@commerce.test | admin |
| budi@commerce.test | customer |

Vouchers: `NGOPI10` (10%, max Rp50.000, min spend Rp150.000) and `HEMAT25K` (Rp25.000 off, min spend Rp200.000).

### With PostgreSQL

```bash
docker compose up --build
```

`NODE_ENV=production` switches Knex to the `pg` client using `DATABASE_URL`. The automated tests run on SQLite.

## Tests

```bash
npm test
```

22 tests using `node:test` and `supertest` against an in-memory database. They cover auth, catalog filters, admin permissions, voucher rules, checkout, idempotent retries, the last-unit race, cancellation, expiry, signature checks, amount mismatch, duplicate notifications and fulfilment.

## API walkthrough

```bash
B=http://localhost:3000

TOKEN=$(curl -s -X POST $B/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"budi@commerce.test","password":"password123"}' | jq -r .token)

curl -s "$B/api/products?category=coffee&sort=price_asc&in_stock=true"

curl -s -X PUT $B/api/cart/items/1 -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"quantity":3}'

curl -s -X POST $B/api/orders/preview -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"voucher_code":"NGOPI10"}'

curl -s -X POST $B/api/orders -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -H 'Idempotency-Key: checkout-7f2c1a' \
  -d '{"voucher_code":"NGOPI10","shipping_address":{"recipient":"Budi Santoso","phone":"081234567890","line1":"Jl. Imam Bonjol No. 10","city":"Tangerang","province":"Banten","postal_code":"15115"}}'
```

```json
{
  "data": {
    "number": "ORD-20261124-641646",
    "status": "pending_payment",
    "subtotal": 294000,
    "discount": 29400,
    "shipping_fee": 15000,
    "total": 279600,
    "expires_at": "2026-11-24T05:35:56.253Z",
    "items": [{ "sku": "CF-ACEH-250", "price": 98000, "quantity": 3, "line_total": 294000 }],
    "history": [{ "from_status": null, "to_status": "pending_payment", "actor": "user:2" }]
  }
}
```

Simulate the payment gateway calling back:

```bash
BODY=$(npm run -s sign-webhook -- ORD-20261124-641646 279600)
curl -s -X POST $B/api/payments/notifications -H 'content-type: application/json' -d "$BODY"
# {"result":"applied","status":"paid"}
```

### Endpoints

| Method | Path | Auth |
|---|---|---|
| POST | `/api/auth/register` | |
| POST | `/api/auth/login` | |
| GET | `/api/auth/me` | user |
| GET | `/api/categories` | |
| GET | `/api/products` | |
| GET | `/api/products/:slug` | |
| POST | `/api/products` | admin |
| PATCH | `/api/products/:id` | admin |
| DELETE | `/api/products/:id` | admin |
| GET | `/api/cart` | user |
| PUT | `/api/cart/items/:productId` | user |
| DELETE | `/api/cart/items/:productId` | user |
| DELETE | `/api/cart` | user |
| POST | `/api/orders/preview` | user |
| POST | `/api/orders` | user |
| GET | `/api/orders` | user |
| GET | `/api/orders/:number` | user |
| POST | `/api/orders/:number/cancel` | user |
| GET | `/api/admin/orders` | admin |
| PATCH | `/api/admin/orders/:number/status` | admin |
| GET, POST | `/api/admin/vouchers` | admin |
| POST | `/api/payments/notifications` | signature |

Errors share one shape:

```json
{ "error": { "code": "insufficient_stock", "message": "Only 12 left in stock", "details": { "available": 12 } } }
```

## Project layout

```
src/
  app.js              express app and routing
  server.js           http server, expiry sweep, graceful shutdown
  config.js
  db.js
  lib/                errors, pagination, slugs
  middleware/         auth, validation, error handler
  modules/
    auth/
    catalog/
    cart/
    orders/           pricing, checkout, state machine, expiry
    payments/         notification handler and signature
    vouchers/
migrations/
seeds/
scripts/
test/
```
