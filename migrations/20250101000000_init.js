exports.up = async (knex) => {
  await knex.schema.createTable('users', (t) => {
    t.increments('id');
    t.string('name', 120).notNullable();
    t.string('email', 190).notNullable().unique();
    t.string('password_hash').notNullable();
    t.string('role', 20).notNullable().defaultTo('customer');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('categories', (t) => {
    t.increments('id');
    t.string('name', 80).notNullable();
    t.string('slug', 100).notNullable().unique();
  });

  await knex.schema.createTable('products', (t) => {
    t.increments('id');
    t.integer('category_id').unsigned().references('categories.id').onDelete('SET NULL');
    t.string('sku', 40).notNullable().unique();
    t.string('name', 160).notNullable();
    t.string('slug', 180).notNullable().unique();
    t.text('description');
    t.bigInteger('price').notNullable();
    t.integer('stock').notNullable().defaultTo(0);
    t.integer('weight_grams').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.index(['category_id', 'is_active']);
  });

  await knex.schema.createTable('cart_items', (t) => {
    t.increments('id');
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.integer('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.integer('quantity').notNullable();
    t.timestamps(true, true);
    t.unique(['user_id', 'product_id']);
  });

  await knex.schema.createTable('vouchers', (t) => {
    t.increments('id');
    t.string('code', 40).notNullable().unique();
    t.string('type', 20).notNullable();
    t.bigInteger('value').notNullable();
    t.bigInteger('max_discount');
    t.bigInteger('min_spend').notNullable().defaultTo(0);
    t.integer('quota').notNullable();
    t.integer('used').notNullable().defaultTo(0);
    t.string('starts_at', 30).notNullable();
    t.string('ends_at', 30).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('orders', (t) => {
    t.increments('id');
    t.string('number', 32).notNullable().unique();
    t.integer('user_id').unsigned().notNullable().references('users.id');
    t.string('status', 24).notNullable();
    t.bigInteger('subtotal').notNullable();
    t.bigInteger('discount').notNullable().defaultTo(0);
    t.bigInteger('shipping_fee').notNullable().defaultTo(0);
    t.bigInteger('total').notNullable();
    t.integer('voucher_id').unsigned().references('vouchers.id');
    t.text('shipping_address').notNullable();
    t.string('tracking_number', 60);
    t.string('idempotency_key', 80);
    t.string('expires_at', 30).notNullable();
    t.string('paid_at', 30);
    t.timestamps(true, true);
    t.unique(['user_id', 'idempotency_key']);
    t.index(['status', 'expires_at']);
    t.index(['user_id', 'created_at']);
  });

  await knex.schema.createTable('order_items', (t) => {
    t.increments('id');
    t.integer('order_id').unsigned().notNullable().references('orders.id').onDelete('CASCADE');
    t.integer('product_id').unsigned().notNullable().references('products.id');
    t.string('sku', 40).notNullable();
    t.string('name', 160).notNullable();
    t.bigInteger('price').notNullable();
    t.integer('quantity').notNullable();
    t.bigInteger('line_total').notNullable();
  });

  await knex.schema.createTable('order_events', (t) => {
    t.increments('id');
    t.integer('order_id').unsigned().notNullable().references('orders.id').onDelete('CASCADE');
    t.string('from_status', 24);
    t.string('to_status', 24).notNullable();
    t.string('actor', 40).notNullable();
    t.string('note', 255);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('payments', (t) => {
    t.increments('id');
    t.integer('order_id').unsigned().notNullable().references('orders.id');
    t.string('provider', 30).notNullable();
    t.string('transaction_id', 80).notNullable();
    t.string('transaction_status', 30).notNullable();
    t.bigInteger('amount').notNullable();
    t.text('payload').notNullable();
    t.timestamps(true, true);
    t.unique(['provider', 'transaction_id', 'transaction_status']);
  });
};

exports.down = async (knex) => {
  for (const table of ['payments', 'order_events', 'order_items', 'orders', 'vouchers', 'cart_items', 'products', 'categories', 'users']) {
    await knex.schema.dropTableIfExists(table);
  }
};
