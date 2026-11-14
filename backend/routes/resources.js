// resources.js - Module D: inventory, processes, Banker's requests, release, termination, deadlock detection, demo scenarios.
// MySQL is the single source of truth. Every state-changing operation:
//   1. starts a transaction, 2. locks ALL resource_types rows FOR UPDATE in ascending resource_id order (no lock-order cycles),
//   3. reads a consistent snapshot, 4. runs the C++ algorithm on that snapshot, 5. writes + logs, 6. commits (or rolls back).
const express = require('express');
const { pool, tx } = require('../lib/db');
const { runCpp } = require('../lib/cpp');
const { AppError, wrap, toInt, toStr, toEnum, toVec } = require('../lib/http');
const { SCENARIOS, RESOURCE_NAMES } = require('../lib/scenarios');

const router = express.Router();

// ---------- snapshot ----------
async function loadState(conn, lock) {
  const [resources] = await conn.execute(
    `SELECT resource_id, name, total_instances, allocated_instances, available_instances, status FROM resource_types ORDER BY resource_id${lock ? ' FOR UPDATE' : ''}`);
  const [procs] = await conn.execute("SELECT process_id, name, description FROM processes WHERE status = 'ACTIVE' ORDER BY process_id");
  const grid = async (table, col) => {
    const [rows] = await conn.execute(`SELECT process_id, resource_id, ${col} AS v FROM ${table}`);
    const m = new Map(rows.map((r) => [`${r.process_id}:${r.resource_id}`, r.v]));
    return procs.map((p) => resources.map((r) => m.get(`${p.process_id}:${r.resource_id}`) || 0));
  };
  const allocation = await grid('allocations', 'units');
  const max = await grid('max_demands', 'max_units');
  const request = await grid('outstanding_requests', 'units');
  const need = max.map((row, i) => row.map((x, j) => Math.max(0, x - allocation[i][j])));
  const available = resources.map((r) => r.available_instances);
  // Consistency check: the stored per-resource counter must equal the sum of per-process allocations.
  resources.forEach((r, j) => {
    const sum = allocation.reduce((s, row) => s + row[j], 0);
    if (sum !== r.allocated_instances) throw new AppError(409, `Inconsistent state for '${r.name}': counters and allocations differ.`, 'INCONSISTENT');
  });
  return { resources, procs, allocation, max, need, request, available };
}

const bankersInput = (s, extra) => ({ available: s.available, allocation: s.allocation, max: s.max, processes: s.procs.map((p) => p.name), ...extra });

async function log(conn, procId, procName, type, decision, quantities, message) {
  await conn.execute(
    'INSERT INTO resource_transactions (process_id, process_name, txn_type, decision, quantities, message) VALUES (?, ?, ?, ?, ?, ?)',
    [procId, procName, type, decision, JSON.stringify(quantities), String(message).slice(0, 255)]);
}

function findProcess(s, rawId) {
  const id = toInt(rawId, 'processId', { min: 1 });
  const idx = s.procs.findIndex((p) => p.process_id === id);
  if (idx < 0) throw new AppError(404, 'Process not found or already terminated.', 'NOT_FOUND');
  return idx;
}

// Runs deadlock detection on a fresh consistent snapshot and stores the result.
async function detect() {
  return tx(async (conn) => {
    const s = await loadState(conn, false);
    const out = await runCpp('deadlock_detection', { available: s.available, allocation: s.allocation, request: s.request, processes: s.procs.map((p) => p.name) });
    await conn.execute('INSERT INTO deadlock_checks (result, finishable, unfinished, explanation) VALUES (?, ?, ?, ?)',
      [out.result, JSON.stringify(out.finishable), JSON.stringify(out.unfinished), String(out.explanation).slice(0, 255)]);
    return { ...out, resourceNames: s.resources.map((r) => r.name), available: s.available, allocation: s.allocation, request: s.request, processes: s.procs.map((p) => p.name) };
  });
}

// ---------- state & history ----------
router.get('/state', wrap(async (req, res) => {
  const s = await tx((conn) => loadState(conn, false));
  res.json({ ok: true, data: { resources: s.resources, processes: s.procs, available: s.available, allocation: s.allocation, max: s.max, need: s.need, request: s.request } });
}));

router.get('/transactions', wrap(async (req, res) => {
  const [rows] = await pool.execute('SELECT txn_id, process_name, txn_type, decision, quantities, message, created_at FROM resource_transactions ORDER BY txn_id DESC LIMIT 50');
  res.json({ ok: true, data: rows });
}));

router.get('/deadlock/checks', wrap(async (req, res) => {
  const [rows] = await pool.execute('SELECT check_id, result, finishable, unfinished, explanation, created_at FROM deadlock_checks ORDER BY check_id DESC LIMIT 50');
  res.json({ ok: true, data: rows });
}));

// ---------- resource types CRUD (allocated count is server-controlled) ----------
router.get('/resources', wrap(async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM resource_types ORDER BY resource_id');
  res.json({ ok: true, data: rows });
}));
const resourceBody = (b) => ({ name: toStr(b.name, 'name', 60), total: toInt(b.total_instances, 'total_instances', { min: 0, max: 100000 }),
  status: toEnum(b.status || 'ONLINE', 'status', ['ONLINE', 'OFFLINE']) });
router.post('/resources', wrap(async (req, res) => {
  const v = resourceBody(req.body || {});
  const [r] = await pool.execute('INSERT INTO resource_types (name, total_instances, status) VALUES (?, ?, ?)', [v.name, v.total, v.status]);
  res.status(201).json({ ok: true, data: { resource_id: r.insertId } });
}));
router.put('/resources/:id', wrap(async (req, res) => {
  const id = toInt(req.params.id, 'id', { min: 1 });
  const v = resourceBody(req.body || {});
  await tx(async (conn) => {
    await conn.execute('SELECT resource_id FROM resource_types WHERE resource_id = ? FOR UPDATE', [id]);
    const [r] = await conn.execute('UPDATE resource_types SET name = ?, total_instances = ?, status = ? WHERE resource_id = ?', [v.name, v.total, v.status, id]);
    if (!r.affectedRows) throw new AppError(404, 'Resource not found', 'NOT_FOUND');
  }); // CHECK constraint rejects total < allocated
  res.json({ ok: true, data: { resource_id: id } });
}));
router.delete('/resources/:id', wrap(async (req, res) => {
  const id = toInt(req.params.id, 'id', { min: 1 });
  await tx(async (conn) => {
    const [rows] = await conn.execute('SELECT allocated_instances FROM resource_types WHERE resource_id = ? FOR UPDATE', [id]);
    if (!rows.length) throw new AppError(404, 'Resource not found', 'NOT_FOUND');
    if (rows[0].allocated_instances > 0) throw new AppError(409, 'Release all allocated instances before deleting this resource type.', 'IN_USE');
    await conn.execute('DELETE FROM resource_types WHERE resource_id = ?', [id]);
  });
  res.json({ ok: true, data: { deleted: id } });
}));

// ---------- processes with maximum demands ----------
async function saveDemands(conn, processId, body) {
  const [resources] = await conn.execute('SELECT resource_id FROM resource_types ORDER BY resource_id');
  for (const r of resources) {
    const raw = body[`max_${r.resource_id}`];
    const units = toInt(raw === undefined || raw === '' ? 0 : raw, `max_${r.resource_id}`, { min: 0, max: 100000 });
    await conn.execute('INSERT INTO max_demands (process_id, resource_id, max_units) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE max_units = VALUES(max_units)',
      [processId, r.resource_id, units]);
  }
}
router.get('/processes', wrap(async (req, res) => {
  const [procs] = await pool.execute('SELECT process_id, name, description, status FROM processes ORDER BY process_id');
  const [max] = await pool.execute('SELECT process_id, resource_id, max_units FROM max_demands');
  const data = procs.map((p) => {
    const row = { ...p };
    max.filter((m) => m.process_id === p.process_id).forEach((m) => { row[`max_${m.resource_id}`] = m.max_units; });
    return row;
  });
  res.json({ ok: true, data });
}));
router.post('/processes', wrap(async (req, res) => {
  const b = req.body || {};
  const name = toStr(b.name, 'name', 30);
  const description = b.description ? toStr(b.description, 'description', 120) : '';
  const id = await tx(async (conn) => {
    await conn.execute('SELECT resource_id FROM resource_types ORDER BY resource_id FOR UPDATE');
    const [r] = await conn.execute('INSERT INTO processes (name, description) VALUES (?, ?)', [name, description]);
    await saveDemands(conn, r.insertId, b);
    return r.insertId;
  });
  res.status(201).json({ ok: true, data: { process_id: id } });
}));
router.put('/processes/:id', wrap(async (req, res) => {
  const id = toInt(req.params.id, 'id', { min: 1 });
  const b = req.body || {};
  const name = toStr(b.name, 'name', 30);
  const description = b.description ? toStr(b.description, 'description', 120) : '';
  await tx(async (conn) => {
    await conn.execute('SELECT resource_id FROM resource_types ORDER BY resource_id FOR UPDATE');
    const [r] = await conn.execute('UPDATE processes SET name = ?, description = ? WHERE process_id = ?', [name, description, id]);
    if (!r.affectedRows) throw new AppError(404, 'Process not found', 'NOT_FOUND');
    const [held] = await conn.execute('SELECT resource_id, units FROM allocations WHERE process_id = ? AND units > 0', [id]);
    for (const h of held) {
      const raw = b[`max_${h.resource_id}`];
      if (raw !== undefined && raw !== '' && toInt(raw, 'max', { min: 0 }) < h.units) throw new AppError(400, 'Maximum demand cannot be lower than what the process already holds.', 'VALIDATION');
    }
    await saveDemands(conn, id, b);
  });
  res.json({ ok: true, data: { process_id: id } });
}));
router.delete('/processes/:id', wrap(async (req, res) => {
  const id = toInt(req.params.id, 'id', { min: 1 });
  await tx(async (conn) => {
    await conn.execute('SELECT resource_id FROM resource_types ORDER BY resource_id FOR UPDATE');
    const [held] = await conn.execute('SELECT 1 FROM allocations WHERE process_id = ? AND units > 0 LIMIT 1', [id]);
    if (held.length) throw new AppError(409, 'Process still holds resources. Release them or terminate the process first.', 'IN_USE');
    const [r] = await conn.execute('DELETE FROM processes WHERE process_id = ?', [id]);
    if (!r.affectedRows) throw new AppError(404, 'Process not found', 'NOT_FOUND');
  });
  res.json({ ok: true, data: { deleted: id } });
}));

// ---------- Banker's: safety check and resource request ----------
router.post('/bankers/safety', wrap(async (req, res) => {
  const s = await tx((conn) => loadState(conn, false));
  const out = await runCpp('bankers_algorithm', bankersInput(s, { action: 'safety' }));
  res.json({ ok: true, data: out });
}));

router.post('/resources/request', wrap(async (req, res) => {
  const b = req.body || {};
  const result = await tx(async (conn) => {
    const s = await loadState(conn, true); // locks all resource rows; nobody else can change allocations until we finish
    const idx = findProcess(s, b.processId);
    const request = toVec(b.request, 'request', s.resources.length);
    const proc = s.procs[idx];
    const offline = s.resources.filter((r, j) => request[j] > 0 && r.status === 'OFFLINE');
    let out;
    if (offline.length) {
      out = { decision: 'DENIED_OFFLINE', safe: false, safeSequence: [], explanation: `Resource '${offline[0].name}' is offline.`, need: s.need };
    } else {
      out = await runCpp('bankers_algorithm', bankersInput(s, { action: 'request', processIndex: idx, request }));
    }
    if (out.decision === 'GRANTED') {
      for (let j = 0; j < request.length; j++) {
        if (request[j] === 0) continue;
        const rid = s.resources[j].resource_id;
        await conn.execute('INSERT INTO allocations (process_id, resource_id, units) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE units = units + VALUES(units)',
          [proc.process_id, rid, request[j]]);
        const [u] = await conn.execute(
          'UPDATE resource_types SET allocated_instances = allocated_instances + ? WHERE resource_id = ? AND available_instances >= ?', [request[j], rid, request[j]]);
        if (u.affectedRows !== 1) throw new AppError(409, 'Allocation would exceed total instances; rolled back.', 'OVER_ALLOCATION');
      }
      await conn.execute('UPDATE outstanding_requests SET units = 0 WHERE process_id = ?', [proc.process_id]);
    } else if (b.queueIfDenied && ['DENIED_EXCEEDS_AVAILABLE', 'DENIED_UNSAFE'].includes(out.decision)) {
      for (let j = 0; j < request.length; j++) {
        await conn.execute('INSERT INTO outstanding_requests (process_id, resource_id, units) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE units = VALUES(units)',
          [proc.process_id, s.resources[j].resource_id, request[j]]);
      }
      out.explanation += ' Recorded as a waiting request for deadlock detection.';
    }
    await log(conn, proc.process_id, proc.name, 'REQUEST', out.decision, { request }, out.explanation);
    return { ...out, process: proc.name, request, resourceNames: s.resources.map((r) => r.name), available: s.available, allocation: s.allocation, max: s.max };
  });
  res.json({ ok: true, data: result });
}));

// ---------- release & terminate ----------
router.post('/resources/release', wrap(async (req, res) => {
  const b = req.body || {};
  const released = await tx(async (conn) => {
    const s = await loadState(conn, true);
    const idx = findProcess(s, b.processId);
    const rel = toVec(b.release, 'release', s.resources.length);
    if (rel.every((x) => x === 0)) throw new AppError(400, 'Release quantities are all zero.', 'VALIDATION');
    rel.forEach((x, j) => {
      if (x > s.allocation[idx][j]) throw new AppError(400, `Cannot release ${x} of '${s.resources[j].name}': process holds only ${s.allocation[idx][j]}.`, 'VALIDATION');
    });
    const proc = s.procs[idx];
    for (let j = 0; j < rel.length; j++) {
      if (rel[j] === 0) continue;
      await conn.execute('UPDATE allocations SET units = units - ? WHERE process_id = ? AND resource_id = ?', [rel[j], proc.process_id, s.resources[j].resource_id]);
      await conn.execute('UPDATE resource_types SET allocated_instances = allocated_instances - ? WHERE resource_id = ?', [rel[j], s.resources[j].resource_id]);
    }
    await log(conn, proc.process_id, proc.name, 'RELEASE', 'RELEASED', { release: rel }, `${proc.name} released resources.`);
    const newAvail = s.available.map((a, j) => a + rel[j]);
    const nowFit = s.procs.filter((p, i) => s.request[i].some((x) => x > 0) && s.request[i].every((x, j) => x <= newAvail[j])).map((p) => p.name);
    return { process: proc.name, release: rel, newAvailable: newAvail, waitingRequestsNowSatisfiable: nowFit };
  });
  const detection = await detect(); // re-run the check after a release
  res.json({ ok: true, data: { ...released, detection } });
}));

router.post('/processes/:id/terminate', wrap(async (req, res) => {
  if ((req.body || {}).confirm !== true) throw new AppError(400, 'Terminating a simulated process requires confirm: true.', 'CONFIRM_REQUIRED');
  const id = toInt(req.params.id, 'id', { min: 1 });
  const out = await tx(async (conn) => {
    const s = await loadState(conn, true);
    const idx = findProcess(s, id);
    const proc = s.procs[idx];
    for (let j = 0; j < s.resources.length; j++) {
      if (s.allocation[idx][j] === 0) continue;
      await conn.execute('UPDATE resource_types SET allocated_instances = allocated_instances - ? WHERE resource_id = ?', [s.allocation[idx][j], s.resources[j].resource_id]);
    }
    await conn.execute('UPDATE allocations SET units = 0 WHERE process_id = ?', [id]);
    await conn.execute('UPDATE outstanding_requests SET units = 0 WHERE process_id = ?', [id]);
    await conn.execute("UPDATE processes SET status = 'TERMINATED' WHERE process_id = ?", [id]);
    await log(conn, id, proc.name, 'TERMINATE', 'TERMINATED', { released: s.allocation[idx] }, `Recovery action: ${proc.name} terminated and its resources were released.`);
    return { process: proc.name, released: s.allocation[idx] };
  });
  const detection = await detect();
  res.json({ ok: true, data: { ...out, detection } });
}));

router.post('/deadlock/detect', wrap(async (req, res) => {
  res.json({ ok: true, data: await detect() });
}));

// ---------- demo scenarios ----------
async function initScenario(n) {
  const sc = SCENARIOS[n];
  const st = sc.state;
  await tx(async (conn) => {
    await conn.execute('SELECT resource_id FROM resource_types ORDER BY resource_id FOR UPDATE');
    await conn.execute('DELETE FROM processes');       // cascades to demands, allocations, waiting requests
    await conn.execute('DELETE FROM resource_types');
    const ids = [];
    for (let j = 0; j < RESOURCE_NAMES.length; j++) {
      const allocated = st.alloc.reduce((sum, row) => sum + row[j], 0);
      const [r] = await conn.execute('INSERT INTO resource_types (name, total_instances, allocated_instances) VALUES (?, ?, ?)', [RESOURCE_NAMES[j], st.totals[j], allocated]);
      ids.push(r.insertId);
    }
    for (let i = 0; i < st.processes.length; i++) {
      const [p] = await conn.execute('INSERT INTO processes (name, description) VALUES (?, ?)', [st.processes[i], st.descriptions[i]]);
      for (let j = 0; j < ids.length; j++) {
        await conn.execute('INSERT INTO max_demands (process_id, resource_id, max_units) VALUES (?, ?, ?)', [p.insertId, ids[j], st.max[i][j]]);
        await conn.execute('INSERT INTO allocations (process_id, resource_id, units) VALUES (?, ?, ?)', [p.insertId, ids[j], st.alloc[i][j]]);
        await conn.execute('INSERT INTO outstanding_requests (process_id, resource_id, units) VALUES (?, ?, ?)', [p.insertId, ids[j], st.wait[i][j]]);
      }
    }
    await log(conn, null, '-', 'DEMO_INIT', 'SCENARIO_' + n, { scenario: n }, `Loaded demo scenario: ${sc.title}`);
  });
  return { scenario: n, title: sc.title, note: sc.note, suggest: sc.suggest };
}

router.get('/demo/scenarios', (req, res) => {
  res.json({ ok: true, data: Object.entries(SCENARIOS).map(([id, s]) => ({ id: Number(id), title: s.title, note: s.note })) });
});
router.post('/demo/init', wrap(async (req, res) => {
  const n = toInt((req.body || {}).scenario, 'scenario', { min: 1, max: 6 });
  res.json({ ok: true, data: await initScenario(n) });
}));
router.post('/demo/reset', wrap(async (req, res) => {
  res.json({ ok: true, data: await initScenario(1) });
}));

module.exports = router;
