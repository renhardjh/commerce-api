const bcrypt = require('bcryptjs');
const { slugify } = require('../src/lib/slug');

const categories = [
  { name: 'Coffee', slug: 'coffee' },
  { name: 'Brewing Gear', slug: 'brewing-gear' },
  { name: 'Merchandise', slug: 'merchandise' },
];

const products = [
  ['coffee', 'CF-ACEH-250', 'Aceh Gayo Arabica 250g', 'Washed process, notes of dark chocolate and spice.', 98000, 120, 260],
  ['coffee', 'CF-TORAJA-250', 'Toraja Sapan 250g', 'Full body with a long herbal finish.', 115000, 80, 260],
  ['coffee', 'CF-KINTAMANI-250', 'Bali Kintamani 250g', 'Citrus acidity, honey sweetness.', 105000, 60, 260],
  ['coffee', 'CF-FLORES-250', 'Flores Bajawa 250g', 'Nutty and smooth, good for espresso.', 99000, 0, 260],
  ['coffee', 'CF-JAVA-1KG', 'Java Preanger 1kg', 'House blend for cafes.', 360000, 25, 1050],
  ['brewing-gear', 'BG-V60-02', 'Ceramic Dripper 02', 'Spiral ribs, fits 1-4 cups.', 185000, 40, 450],
  ['brewing-gear', 'BG-KETTLE-600', 'Gooseneck Kettle 600ml', 'Stainless steel, stovetop safe.', 275000, 18, 700],
  ['brewing-gear', 'BG-GRINDER-HAND', 'Hand Grinder Steel Burr', 'Adjustable 40-click burr.', 450000, 12, 650],
  ['brewing-gear', 'BG-SCALE-01', 'Brew Scale with Timer', '0.1g precision, USB-C charging.', 325000, 30, 400],
  ['brewing-gear', 'BG-FILTER-100', 'Paper Filter 02 (100 pcs)', 'Unbleached paper filters.', 45000, 200, 120],
  ['merchandise', 'MC-TUMBLER-500', 'Insulated Tumbler 500ml', 'Keeps drinks hot for 6 hours.', 159000, 50, 380],
  ['merchandise', 'MC-TOTE-01', 'Canvas Tote Bag', 'Heavy cotton canvas.', 79000, 75, 200],
];

exports.seed = async (knex) => {
  for (const table of ['payments', 'order_events', 'order_items', 'orders', 'cart_items', 'vouchers', 'products', 'categories', 'users']) {
    await knex(table).del();
  }

  const passwordHash = await bcrypt.hash('password123', 10);
  await knex('users').insert([
    { name: 'Store Admin', email: 'admin@commerce.test', password_hash: passwordHash, role: 'admin' },
    { name: 'Budi Santoso', email: 'budi@commerce.test', password_hash: passwordHash, role: 'customer' },
  ]);

  await knex('categories').insert(categories);
  const categoryIds = Object.fromEntries((await knex('categories').select('id', 'slug')).map((c) => [c.slug, c.id]));

  await knex('products').insert(
    products.map(([category, sku, name, description, price, stock, weight]) => ({
      category_id: categoryIds[category],
      sku,
      name,
      slug: slugify(name),
      description,
      price,
      stock,
      weight_grams: weight,
    })),
  );

  const start = new Date('2025-01-01T00:00:00Z').toISOString();
  const end = new Date('2030-12-31T23:59:59Z').toISOString();
  await knex('vouchers').insert([
    { code: 'NGOPI10', type: 'percentage', value: 10, max_discount: 50000, min_spend: 150000, quota: 500, starts_at: start, ends_at: end },
    { code: 'HEMAT25K', type: 'fixed', value: 25000, max_discount: null, min_spend: 200000, quota: 100, starts_at: start, ends_at: end },
  ]);
};
