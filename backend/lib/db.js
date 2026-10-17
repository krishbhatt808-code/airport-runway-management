// db.js - MySQL connection pool and a transaction helper. Credentials come only from environment variables.
require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'airport_runway_db',
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,
  connectTimeout: 5000,
});

// Runs fn(conn) inside a transaction; commits on success, rolls back on any error.
async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* connection already lost */ }
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, tx };
