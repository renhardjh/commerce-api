async function loadCart(db, userId) {
  const rows = await db('cart_items')
    .join('products', 'products.id', 'cart_items.product_id')
    .where('cart_items.user_id', userId)
    .orderBy('cart_items.id')
    .select(
      'cart_items.product_id',
      'cart_items.quantity',
      'products.sku',
      'products.name',
      'products.slug',
      'products.price',
      'products.stock',
      'products.weight_grams',
      'products.is_active',
    );

  const items = rows.map((row) => {
    const available = Boolean(row.is_active) && row.stock >= row.quantity;
    return {
      product_id: row.product_id,
      sku: row.sku,
      name: row.name,
      slug: row.slug,
      price: Number(row.price),
      quantity: row.quantity,
      stock: row.stock,
      weight_grams: row.weight_grams,
      line_total: Number(row.price) * row.quantity,
      available,
      ...(!available && { issue: row.is_active ? 'insufficient_stock' : 'product_unavailable' }),
    };
  });

  return {
    items,
    subtotal: items.reduce((sum, item) => sum + item.line_total, 0),
    total_quantity: items.reduce((sum, item) => sum + item.quantity, 0),
  };
}

module.exports = { loadCart };
