// records.js - CRUD for aircraft, flights, runways, baggage batches, maintenance tasks + dashboard and reports.
// Table and column names come ONLY from the config below; user values are always bound as ? parameters.
const express = require('express');
const { pool } = require('../lib/db');
const { AppError, wrap, toInt, toStr, toEnum } = require('../lib/http');

const str = (max) => ({ t: 'str', max });
const int = (min, max, nullable = false) => ({ t: 'int', min, max, nullable });
const enm = (vals, def) => ({ t: 'enum', vals, def });
const ID = [1, 2147483647];
const TIME = [0, 100000];
const BURST = [1, 1000];
const PRIO = [1, 99];

const CONFIG = {
  aircraft: { table: 'aircraft', pk: 'aircraft_id', sel: 'SELECT * FROM aircraft', pkCol: 'aircraft_id',
    fields: { registration: str(20), model: str(40), airline: str(60), status: enm(['ACTIVE', 'IN_MAINTENANCE', 'RETIRED'], 'ACTIVE') } },
  runways: { table: 'runways', pk: 'runway_id', sel: 'SELECT * FROM runways', pkCol: 'runway_id',
    fields: { name: str(20), length_m: int(500, 6000), status: enm(['ACTIVE', 'CLOSED', 'MAINTENANCE'], 'ACTIVE') } },
  flights: { table: 'flights', pk: 'flight_id', pkCol: 'f.flight_id',
    sel: 'SELECT f.*, a.registration FROM flights f JOIN aircraft a ON a.aircraft_id = f.aircraft_id',
    fields: { flight_number: str(12), aircraft_id: int(...ID), runway_id: int(...ID, true), operation: enm(['ARRIVAL', 'DEPARTURE'], 'ARRIVAL'),
      arrival_time: int(...TIME), burst_time: int(...BURST), priority: int(...PRIO) } },
  'baggage-batches': { table: 'baggage_batches', pk: 'batch_id', pkCol: 'b.batch_id',
    sel: 'SELECT b.*, f.flight_number FROM baggage_batches b JOIN flights f ON f.flight_id = b.flight_id',
    fields: { flight_id: int(...ID), bag_count: int(0, 100000), arrival_time: int(...TIME), burst_time: int(...BURST), priority: int(...PRIO) } },
  'maintenance-tasks': { table: 'maintenance_tasks', pk: 'task_id', pkCol: 't.task_id',
    sel: 'SELECT t.*, a.registration FROM maintenance_tasks t JOIN aircraft a ON a.aircraft_id = t.aircraft_id',
    fields: { aircraft_id: int(...ID), description: str(120), arrival_time: int(...TIME), burst_time: int(...BURST), priority: int(...PRIO),
      status: enm(['PENDING', 'COMPLETED'], 'PENDING') } },
};

// Validates a request body against a table's field specs and returns { column: value }.
function validate(cfg, body) {
  const out = {};
  for (const [name, spec] of Object.entries(cfg.fields)) {
    let v = body[name];
    const empty = v === undefined || v === null || v === '';
    if (empty && spec.t === 'enum' && spec.def) v = spec.def;
    else if (empty && spec.nullable) { out[name] = null; continue; }
    else if (empty) throw new AppError(400, `${name} is required`, 'VALIDATION');
    if (spec.t === 'str') out[name] = toStr(v, name, spec.max);
    else if (spec.t === 'int') out[name] = toInt(v, name, { min: spec.min, max: spec.max });
    else out[name] = toEnum(v, name, spec.vals);
  }
  return out;
}

function crudRouter(cfg) {
  const r = express.Router();
  const order = ` ORDER BY ${cfg.pkCol}`;
  r.get('/', wrap(async (req, res) => {
    const [rows] = await pool.execute(cfg.sel + order);
    res.json({ ok: true, data: rows });
  }));
  r.get('/:id', wrap(async (req, res) => {
    const id = toInt(req.params.id, 'id', { min: 1 });
    const [rows] = await pool.execute(`${cfg.sel} WHERE ${cfg.pkCol} = ?`, [id]);
    if (!rows.length) throw new AppError(404, 'Record not found', 'NOT_FOUND');
    res.json({ ok: true, data: rows[0] });
  }));
  r.post('/', wrap(async (req, res) => {
    const v = validate(cfg, req.body || {});
    const cols = Object.keys(v);
    const [result] = await pool.execute(
      `INSERT INTO ${cfg.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => v[c]));
    res.status(201).json({ ok: true, data: { [cfg.pk]: result.insertId } });
  }));
  r.put('/:id', wrap(async (req, res) => {
    const id = toInt(req.params.id, 'id', { min: 1 });
    const v = validate(cfg, req.body || {});
    const cols = Object.keys(v);
    const [result] = await pool.execute(
      `UPDATE ${cfg.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${cfg.pk} = ?`, [...cols.map((c) => v[c]), id]);
    if (!result.affectedRows) throw new AppError(404, 'Record not found', 'NOT_FOUND');
    res.json({ ok: true, data: { [cfg.pk]: id } });
  }));
  r.delete('/:id', wrap(async (req, res) => {
    const id = toInt(req.params.id, 'id', { min: 1 });
    const [result] = await pool.execute(`DELETE FROM ${cfg.table} WHERE ${cfg.pk} = ?`, [id]);
    if (!result.affectedRows) throw new AppError(404, 'Record not found', 'NOT_FOUND');
    res.json({ ok: true, data: { deleted: id } });
  }));
  return r;
}

const router = express.Router();
for (const [path, cfg] of Object.entries(CONFIG)) router.use('/' + path, crudRouter(cfg));

router.get('/dashboard', wrap(async (req, res) => {
  const one = async (sql) => (await pool.execute(sql))[0][0].n;
  const [resources] = await pool.execute('SELECT name, total_instances, available_instances FROM resource_types ORDER BY resource_id');
  const [byAlgo] = await pool.execute('SELECT algorithm, COUNT(*) AS runs FROM scheduling_runs GROUP BY algorithm ORDER BY algorithm');
  const [recent] = await pool.execute('SELECT run_id, module, algorithm, process_count, avg_waiting, created_at FROM scheduling_runs ORDER BY run_id DESC LIMIT 5');
  res.json({ ok: true, data: {
    aircraft: await one('SELECT COUNT(*) AS n FROM aircraft'),
    flights: await one('SELECT COUNT(*) AS n FROM flights'),
    runways: await one('SELECT COUNT(*) AS n FROM runways'),
    availableResources: await one('SELECT COALESCE(SUM(available_instances),0) AS n FROM resource_types'),
    pendingTasks: await one("SELECT COUNT(*) AS n FROM maintenance_tasks WHERE status = 'PENDING'"),
    completedRuns: await one('SELECT COUNT(*) AS n FROM scheduling_runs'),
    safeRequests: await one("SELECT COUNT(*) AS n FROM resource_transactions WHERE txn_type = 'REQUEST' AND decision = 'GRANTED'"),
    deadlockIncidents: await one("SELECT COUNT(*) AS n FROM deadlock_checks WHERE result = 'DEADLOCK'"),
    resources, runsByAlgorithm: byAlgo, recentRuns: recent,
  } });
}));

router.get('/reports', wrap(async (req, res) => {
  const [perAlgo] = await pool.execute(
    `SELECT module, algorithm, COUNT(*) AS runs, ROUND(AVG(avg_waiting),2) AS avg_waiting,
            ROUND(AVG(avg_turnaround),2) AS avg_turnaround, ROUND(AVG(avg_response),2) AS avg_response
     FROM scheduling_runs GROUP BY module, algorithm ORDER BY module, algorithm`);
  const [decisions] = await pool.execute(
    'SELECT txn_type, decision, COUNT(*) AS count FROM resource_transactions GROUP BY txn_type, decision ORDER BY txn_type, decision');
  const [checks] = await pool.execute('SELECT result, COUNT(*) AS count FROM deadlock_checks GROUP BY result ORDER BY result');
  res.json({ ok: true, data: { perAlgorithm: perAlgo, decisions, deadlockChecks: checks } });
}));

module.exports = router;
