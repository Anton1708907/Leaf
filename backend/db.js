const { Pool } = require('pg');

const pool = new Pool({
  user: 'gpuUser',
  host: 'localhost',
  database: 'leaf',
  password: 'supersecret',
  port: 5432,
});

module.exports = pool;
