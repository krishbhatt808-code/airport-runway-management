// server.js - Express entry point. Serves the frontend and the JSON REST API from one origin (no CORS needed).
require('dotenv').config();
const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { pool } = require('./lib/db');
const { executableStatus } = require('./lib/cpp');
const { wrap, errorHandler } = require('./lib/http');

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:",
  });
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, error: { code: 'RATE_LIMIT', message: 'Too many requests. Please slow down.' } } }));

app.get('/api/health', wrap(async (req, res) => {
  let db = false;
  try { await pool.query('SELECT 1'); db = true; } catch (_) { db = false; }
  const executables = executableStatus();
  const ok = db && Object.values(executables).every(Boolean);
  res.status(ok ? 200 : 503).json({ ok, data: { database: db, executables } });
}));

app.use('/api', require('./routes/records'));
app.use('/api', require('./routes/scheduling'));
app.use('/api', require('./routes/resources'));
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Unknown API endpoint.' } }));

app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use(errorHandler);

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`Airport Runway Management System running at http://localhost:${port}`));
}
module.exports = app;
