const knex = require('knex');
const knexfile = require('../knexfile');
const config = require('./config');

function createDb(env = config.env) {
  const settings = knexfile[env];
  if (!settings) {
    throw new Error(`No database config for environment "${env}"`);
  }
  if (settings.client === 'pg') {
    const { types } = require('pg');
    types.setTypeParser(types.builtins.INT8, Number);
    types.setTypeParser(types.builtins.NUMERIC, Number);
  }
  return knex(settings);
}

module.exports = { createDb };
