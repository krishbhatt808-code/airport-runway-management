// scheduling.js - runs the C++ schedulers on stored records and persists runs/results in MySQL.
const express = require('express');
const { pool, tx } = require('../lib/db');
const { runCpp } = require('../lib/cpp');
const { AppError, wrap, toInt, toEnum } = require('../lib/http');

const MODULES = {
  runway: { exe: 'runway_scheduler', label: 'RUNWAY', algos: ['FCFS', 'PRIORITY_NP'],
    sql: 'SELECT flight_number AS id, arrival_time AS arrival, burst_time AS burst, priority FROM flights ORDER BY flight_id' },
  baggage: { exe: 'baggage_scheduler', label: 'BAGGAGE', algos: ['SRTF', 'PRIORITY_P'],
    sql: `SELECT CONCAT('B', b.batch_id, '-', f.flight_number) AS id, b.arrival_time AS arrival, b.burst_time AS burst, b.priority
          FROM baggage_batches b JOIN flights f ON f.flight_id = b.flight_id ORDER BY b.batch_id` },
  maintenance: { exe: 'maintenance_scheduler', label: 'MAINTENANCE', algos: ['PRIORITY_P', 'RR'],
    sql: `SELECT CONCAT('T', t.task_id, '-', a.registration) AS id, t.arrival_time AS arrival, t.burst_time AS burst, t.priority
          FROM maintenance_tasks t JOIN aircraft a ON a.aircraft_id = t.aircraft_id WHERE t.status = 'PENDING' ORDER BY t.task_id` },
};

const router = express.Router();

router.post('/schedule/:module', wrap(async (req, res) => {
  const mod = MODULES[req.params.module];
  if (!mod) throw new AppError(404, 'Unknown scheduling module', 'NOT_FOUND');
  const body = req.body || {};
  const algorithm = toEnum(body.algorithm, 'algorithm', mod.algos);
  const quantum = algorithm === 'RR' ? toInt(body.quantum, 'quantum', { min: 1, max: 1000 }) : null;

  const [processes] = await pool.execute(mod.sql);
  const out = await runCpp(mod.exe, { algorithm, quantum, processes });
  if (!Array.isArray(out.results) || !Array.isArray(out.gantt) || !out.averages) {
    throw new AppError(502, 'Algorithm returned an unexpected structure.', 'CPP_BAD_OUTPUT');
  }
  let runId = null;
  if (out.results.length > 0) { // empty runs are returned but not stored
    runId = await tx(async (conn) => {
      const [r] = await conn.execute(
        `INSERT INTO scheduling_runs (module, algorithm, quantum, process_count, avg_waiting, avg_turnaround, avg_response, total_time, gantt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [mod.label, algorithm, quantum, out.results.length, out.averages.waiting, out.averages.turnaround, out.averages.response,
          out.totalTime, JSON.stringify(out.gantt)]);
      const rows = out.results.map((p) => [r.insertId, p.id, p.arrival, p.burst, p.priority, p.start, p.completion, p.turnaround, p.waiting, p.response]);
      await conn.query(
        `INSERT INTO scheduling_results (run_id, process_label, arrival_time, burst_time, priority, start_time, completion, turnaround, waiting, response)
         VALUES ?`, [rows]);
      return r.insertId;
    });
  }
  res.json({ ok: true, data: { runId, module: mod.label, ...out } });
}));

router.get('/runs', wrap(async (req, res) => {
  const module = req.query.module ? toEnum(String(req.query.module).toUpperCase(), 'module', ['RUNWAY', 'BAGGAGE', 'MAINTENANCE']) : null;
  const sql = 'SELECT run_id, module, algorithm, quantum, process_count, avg_waiting, avg_turnaround, avg_response, total_time, created_at FROM scheduling_runs'
    + (module ? ' WHERE module = ?' : '') + ' ORDER BY run_id DESC LIMIT 200';
  const [rows] = await pool.execute(sql, module ? [module] : []);
  res.json({ ok: true, data: rows });
}));

router.get('/runs/:id', wrap(async (req, res) => {
  const id = toInt(req.params.id, 'id', { min: 1 });
  const [runs] = await pool.execute('SELECT * FROM scheduling_runs WHERE run_id = ?', [id]);
  if (!runs.length) throw new AppError(404, 'Run not found', 'NOT_FOUND');
  const [results] = await pool.execute(
    `SELECT process_label AS id, arrival_time AS arrival, burst_time AS burst, priority, start_time AS start, completion, turnaround, waiting, response
     FROM scheduling_results WHERE run_id = ? ORDER BY result_id`, [id]);
  const run = runs[0];
  res.json({ ok: true, data: { ...run, results, averages: { waiting: run.avg_waiting, turnaround: run.avg_turnaround, response: run.avg_response }, totalTime: run.total_time } });
}));

router.delete('/runs/:id', wrap(async (req, res) => {
  const id = toInt(req.params.id, 'id', { min: 1 });
  const [r] = await pool.execute('DELETE FROM scheduling_runs WHERE run_id = ?', [id]);
  if (!r.affectedRows) throw new AppError(404, 'Run not found', 'NOT_FOUND');
  res.json({ ok: true, data: { deleted: id } });
}));

module.exports = router;
