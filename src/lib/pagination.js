const { z } = require('zod');

const paginationSchema = {
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
};

async function paginate(query, { page, per_page: perPage }) {
  const countQuery = query.clone().clearSelect().clearOrder().count({ total: '*' }).first();
  const [{ total }, rows] = await Promise.all([
    countQuery,
    query.limit(perPage).offset((page - 1) * perPage),
  ]);
  const count = Number(total);
  return {
    data: rows,
    meta: {
      page,
      per_page: perPage,
      total: count,
      total_pages: Math.max(1, Math.ceil(count / perPage)),
    },
  };
}

module.exports = { paginationSchema, paginate };
