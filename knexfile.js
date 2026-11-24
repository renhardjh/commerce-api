const fs = require('node:fs');
const path = require('node:path');
const config = require('./src/config');

const shared = {
  migrations: { directory: path.join(__dirname, 'migrations') },
  seeds: { directory: path.join(__dirname, 'seeds') },
};

const sqlite = (filename) => ({
  ...shared,
  client: 'better-sqlite3',
  connection: { filename },
  useNullAsDefault: true,
  pool: {
    afterCreate(conn, done) {
      conn.pragma('foreign_keys = ON');
      conn.pragma('journal_mode = WAL');
      done();
    },
  },
});

const development = () => {
  fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true });
  return sqlite(config.sqlitePath);
};

module.exports = {
  get development() {
    return development();
  },
  test: sqlite(':memory:'),
  production: {
    ...shared,
    client: 'pg',
    connection: config.databaseUrl,
    pool: { min: 2, max: 10 },
  },
};
