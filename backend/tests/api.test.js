// API + database integration tests. Needs MySQL (schema.sql + seed.sql loaded), a valid .env and `npm run build`.
// WARNING: these tests reset the demo resource tables and add/remove a few records. Use a development database only.
// Run: npm run test:api
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const app = require('../server');
const { pool } = require('../lib/db');

let base;
let server;
let skip = false;

test.before(async () => {
  try { await pool.query('SELECT 1'); } catch (e) { skip = 'MySQL is not reachable: ' + e.code; return; }
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(async () => { if (server) server.close(); await pool.end(); });

const call = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const state = async () => (await call('GET', '/state')).body.data;
const pidOf = async (name) => (await state()).processes.find((p) => p.name === name).process_id;
const init = (n) => call('POST', '/demo/init', { scenario: n });

test('health reports database and executables', async (t) => {
  if (skip) return t.skip(skip);
  const r = await call('GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.data.database, true);
});

test('CRUD: create, read, update, delete aircraft; duplicate and validation errors', async (t) => {
  if (skip) return t.skip(skip);
  const c = await call('POST', '/aircraft', { registration: 'TST-001', model: 'Test 100', airline: 'Test Air' });
  assert.equal(c.status, 201);
  const id = c.body.data.aircraft_id;
  assert.equal((await call('POST', '/aircraft', { registration: 'TST-001', model: 'x', airline: 'y' })).status, 409);
  assert.equal((await call('POST', '/aircraft', { registration: '', model: 'x', airline: 'y' })).status, 400);
  assert.equal((await call('PUT', `/aircraft/${id}`, { registration: 'TST-001', model: 'Test 200', airline: 'Test Air', status: 'RETIRED' })).status, 200);
  assert.equal((await call('GET', `/aircraft/${id}`)).body.data.model, 'Test 200');
  assert.equal((await call('GET', '/aircraft/abc')).status, 400);
  assert.equal((await call('GET', '/aircraft/999999')).status, 404);
  assert.equal((await call('DELETE', `/aircraft/${id}`)).status, 200);
  assert.equal((await call('DELETE', `/aircraft/${id}`)).status, 404);
});

test('CRUD: invalid foreign key and restricted delete', async (t) => {
  if (skip) return t.skip(skip);
  const bad = await call('POST', '/flights', { flight_number: 'XX1', aircraft_id: 99999, operation: 'ARRIVAL', arrival_time: 0, burst_time: 3, priority: 2 });
  assert.equal(bad.status, 400); assert.equal(bad.body.error.code, 'BAD_REFERENCE');
  assert.equal((await call('DELETE', '/aircraft/1')).status, 409); // aircraft 1 is referenced by a flight
  assert.equal((await call('POST', '/flights', { flight_number: 'XX2', aircraft_id: 1, arrival_time: 0, burst_time: 0, priority: 2 })).status, 400); // burst < 1
});

test('scheduling: runs C++ on stored data and persists run + results', async (t) => {
  if (skip) return t.skip(skip);
  const r = await call('POST', '/schedule/baggage', { algorithm: 'SRTF' });
  assert.equal(r.status, 200);
  const runId = r.body.data.runId;
  assert.ok(runId > 0);
  const h = await call('GET', `/runs/${runId}`);
  assert.equal(h.body.data.results.length, r.body.data.results.length);
  assert.ok(Array.isArray(h.body.data.gantt));
  assert.equal((await call('POST', '/schedule/maintenance', { algorithm: 'RR' })).status, 400);        // quantum required
  assert.equal((await call('POST', '/schedule/maintenance', { algorithm: 'RR', quantum: 3 })).status, 200);
  assert.equal((await call('POST', '/schedule/runway', { algorithm: 'SRTF' })).status, 400);          // not a runway algorithm
  assert.equal((await call('POST', '/schedule/nowhere', { algorithm: 'FCFS' })).status, 404);
});

test('demo scenarios 1-6 produce the documented decisions', async (t) => {
  if (skip) return t.skip(skip);
  const cases = [[1, 'P1', [1, 0, 2, 0], 'GRANTED'], [2, 'P0', [4, 0, 0, 0], 'DENIED_EXCEEDS_AVAILABLE'],
    [3, 'P0', [0, 2, 0, 0], 'DENIED_UNSAFE'], [6, 'P1', [3, 0, 0, 0], 'DENIED_EXCEEDS_MAX']];
  for (const [n, p, request, expected] of cases) {
    await init(n);
    const r = await call('POST', '/resources/request', { processId: await pidOf(p), request });
    assert.equal(r.body.data.decision, expected, `scenario ${n}`);
  }
  await init(1);
  const g = await call('POST', '/resources/request', { processId: await pidOf('P1'), request: [1, 0, 2, 0] });
  assert.ok(g.body.data.safeSequence.length === 5);
  assert.deepEqual((await state()).available, [2, 3, 0, 2]); // committed

  await init(4);
  assert.equal((await call('POST', '/deadlock/detect', {})).body.data.result, 'DEADLOCK');
  await init(5);
  const rel = await call('POST', '/resources/release', { processId: await pidOf('P2'), release: [0, 0, 0, 1] });
  assert.equal(rel.body.data.detection.result, 'NO_DEADLOCK');
  assert.deepEqual(rel.body.data.waitingRequestsNowSatisfiable, ['P1']);
});

test('denied requests do not change state (rollback); queueIfDenied records a waiting request', async (t) => {
  if (skip) return t.skip(skip);
  await init(3);
  const before = await state();
  const r = await call('POST', '/resources/request', { processId: await pidOf('P0'), request: [0, 2, 0, 0], queueIfDenied: true });
  assert.equal(r.body.data.decision, 'DENIED_UNSAFE');
  const after = await state();
  assert.deepEqual(after.available, before.available);
  assert.deepEqual(after.allocation, before.allocation);
  assert.deepEqual(after.request[0], [0, 2, 0, 0]);
  const [rows] = await pool.query("SELECT COUNT(*) n FROM resource_transactions WHERE decision = 'DENIED_UNSAFE'");
  assert.ok(rows[0].n >= 1); // rejected operations are logged
});

test('release validation and terminate confirmation', async (t) => {
  if (skip) return t.skip(skip);
  await init(1);
  const p1 = await pidOf('P1');
  assert.equal((await call('POST', '/resources/release', { processId: p1, release: [5, 0, 0, 0] })).status, 400); // holds only 2
  assert.equal((await call('POST', '/resources/release', { processId: p1, release: [0, 0, 0, 0] })).status, 400);
  assert.equal((await call('POST', '/resources/release', { processId: p1, release: [1, 0] })).status, 400);
  assert.equal((await call('POST', `/processes/${p1}/terminate`, {})).status, 400);                              // no confirmation
  const t1 = await call('POST', `/processes/${p1}/terminate`, { confirm: true });
  assert.equal(t1.status, 200);
  assert.deepEqual((await state()).available, [5, 3, 2, 3]); // P1's (2,0,0,1) returned
  const [rows] = await pool.query("SELECT COUNT(*) n FROM resource_transactions WHERE txn_type = 'TERMINATE'");
  assert.ok(rows[0].n >= 1);
});

test('transaction rollback: failed multi-table create leaves no partial rows', async (t) => {
  if (skip) return t.skip(skip);
  await init(1);
  const rid = (await state()).resources[0].resource_id; // resource ids change after every scenario init
  const r = await call('POST', '/processes', { name: 'RB1', [`max_${rid}`]: 'not-a-number' });
  assert.equal(r.status, 400);
  const [rows] = await pool.query("SELECT COUNT(*) n FROM processes WHERE name = 'RB1'");
  assert.equal(rows[0].n, 0);
  assert.equal((await call('PUT', `/resources/${rid}`, { name: 'Maintenance Bays', total_instances: 3 })).status, 400); // below allocated (7): CHECK
  assert.equal((await call('DELETE', `/resources/${rid}`)).status, 409);                                         // still allocated
});

test('concurrency: parallel requests never over-allocate', async (t) => {
  if (skip) return t.skip(skip);
  await init(1);
  const ids = [await pidOf('P0'), await pidOf('P2'), await pidOf('P4')];
  const jobs = [];
  for (let i = 0; i < 18; i++) jobs.push(call('POST', '/resources/request', { processId: ids[i % 3], request: [1, 0, 0, 0] }));
  const results = await Promise.all(jobs);
  const granted = results.filter((r) => r.body.data && r.body.data.decision === 'GRANTED').length;
  assert.ok(granted <= 3, `granted ${granted} but only 3 bays were free`);
  const s = await state(); // loadState also verifies counters == sum of allocations
  assert.equal(s.available[0], 3 - granted);
  assert.ok(s.available.every((x) => x >= 0));
  const [rows] = await pool.query('SELECT allocated_instances a, total_instances t FROM resource_types');
  assert.ok(rows.every((x) => x.a >= 0 && x.a <= x.t));
});

test('reports, dashboard and reset', async (t) => {
  if (skip) return t.skip(skip);
  const d = (await call('GET', '/dashboard')).body.data;
  assert.ok(d.aircraft >= 1 && d.completedRuns >= 1 && d.safeRequests >= 1);
  assert.ok((await call('GET', '/reports')).body.data.perAlgorithm.length >= 1);
  assert.equal((await call('POST', '/demo/reset', {})).body.data.scenario, 1);
  assert.equal((await call('POST', '/demo/init', { scenario: 9 })).status, 400);
});

test('failure modes: database down and missing C++ executables (fresh processes)', async (t) => {
  if (skip) return t.skip(skip);
  const root = path.join(__dirname, '..', '..');
  const script = `const app=require('./backend/server');const s=app.listen(0,async()=>{const b='http://127.0.0.1:'+s.address().port+'/api';
    const h=await fetch(b+'/health');const a=await fetch(b+'/aircraft');const p=await fetch(b+'/schedule/runway',{method:'POST',headers:{'content-type':'application/json'},body:'{"algorithm":"FCFS"}'});
    console.log(JSON.stringify([h.status,a.status,((await a.json()).error||{}).code,p.status,((await p.json()).error||{}).code]));process.exit(0)})`;
  const down = spawnSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8', env: { ...process.env, DB_PORT: '1' } });
  assert.deepEqual(JSON.parse(down.stdout), [503, 503, 'DB_UNAVAILABLE', 503, 'DB_UNAVAILABLE']);
  const noExe = spawnSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8', env: { ...process.env, CPP_BUILD_DIR: '/nonexistent' } });
  const out = JSON.parse(noExe.stdout);
  assert.deepEqual([out[0], out[3], out[4]], [503, 503, 'CPP_MISSING']);
});
