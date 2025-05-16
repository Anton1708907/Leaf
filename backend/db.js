const { Pool } = require('pg');

const pool = new Pool({
  user: 'gpuuser',
  host: 'localhost',
  database: 'leaf',
  password: '123',
  port: 5432,
});

module.exports = pool;
