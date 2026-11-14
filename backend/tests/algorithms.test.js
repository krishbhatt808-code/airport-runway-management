// Algorithm tests: run the compiled C++ programs through backend/lib/cpp.js (needs `npm run build`).
// Run: npm run test:algorithms
const test = require('node:test');
const assert = require('node:assert/strict');
const { runCpp, executableStatus } = require('../lib/cpp');

const built = Object.values(executableStatus()).every(Boolean);
const skip = built ? false : 'C++ programs not built (run: npm run build)';
const P = (id, arrival, burst, priority = 1) => ({ id, arrival, burst, priority });
const byId = (out, id) => out.results.find((r) => r.id === id);
const sched = (exe, algorithm, processes, quantum) => runCpp(exe, { algorithm, quantum, processes });
const rejects = (promise, code) => assert.rejects(promise, (e) => e.code === code);

test('scheduler: empty list gives zero metrics', { skip }, async () => {
  const o = await sched('runway_scheduler', 'FCFS', []);
  assert.deepEqual(o.results, []);
  assert.equal(o.totalTime, 0);
  assert.equal(o.averages.waiting, 0);
});

test('scheduler: single process metrics', { skip }, async () => {
  const o = await sched('runway_scheduler', 'FCFS', [P('A', 3, 4)]);
  assert.deepEqual(o.gantt, [{ id: 'IDLE', start: 0, end: 3 }, { id: 'A', start: 3, end: 7 }]); // idle period handled
  const a = byId(o, 'A');
  assert.equal(a.completion, 7); assert.equal(a.turnaround, 4); assert.equal(a.waiting, 0); assert.equal(a.response, 0);
});

test('FCFS: textbook example P1(0,24) P2(1,3) P3(2,3)', { skip }, async () => {
  const o = await sched('runway_scheduler', 'FCFS', [P('P1', 0, 24), P('P2', 1, 3), P('P3', 2, 3)]);
  assert.deepEqual(o.sequence, ['P1', 'P2', 'P3']);
  assert.equal(byId(o, 'P2').waiting, 23); assert.equal(byId(o, 'P3').waiting, 25);
  assert.equal(o.averages.waiting, 16); assert.equal(o.totalTime, 30);
  for (const r of o.results) assert.equal(r.response, r.waiting); // non-preemptive: response == waiting
});

test('FCFS: simultaneous arrivals use input order', { skip }, async () => {
  const o = await sched('runway_scheduler', 'FCFS', [P('B', 0, 2), P('A', 0, 2)]);
  assert.deepEqual(o.sequence, ['B', 'A']);
});

test('Priority NP: no interruption, lowest number first, equal priority -> earlier arrival', { skip }, async () => {
  const o = await sched('runway_scheduler', 'PRIORITY_NP', [P('A', 0, 5, 3), P('B', 1, 3, 2), P('C', 2, 8, 4), P('D', 3, 2, 1), P('E', 4, 6, 2)]);
  assert.deepEqual(o.sequence, ['A', 'D', 'B', 'E', 'C']); // A not interrupted by higher-priority D; B before E (earlier arrival)
  assert.equal(o.gantt.length, 5);
  assert.equal(o.totalTime, 24);
});

test('SRTF: preemption and resumption with split Gantt intervals', { skip }, async () => {
  const o = await sched('baggage_scheduler', 'SRTF', [P('A', 0, 8), P('B', 1, 4), P('C', 2, 2), P('D', 20, 1)]);
  assert.deepEqual(o.gantt.map((g) => `${g.id}:${g.start}-${g.end}`), ['A:0-1', 'B:1-2', 'C:2-4', 'B:4-7', 'A:7-14', 'IDLE:14-20', 'D:20-21']);
  assert.equal(byId(o, 'A').completion, 14); assert.equal(byId(o, 'A').waiting, 6);
  assert.equal(byId(o, 'B').waiting, 2); assert.equal(byId(o, 'B').response, 0);
  assert.equal(o.averages.turnaround, 5.75);
});

test('Preemptive priority: urgent task interrupts, ties keep running task', { skip }, async () => {
  const o = await sched('maintenance_scheduler', 'PRIORITY_P', [P('A', 0, 6, 3), P('B', 2, 2, 1), P('C', 3, 2, 3)]);
  assert.deepEqual(o.gantt.map((g) => `${g.id}:${g.start}-${g.end}`), ['A:0-2', 'B:2-4', 'A:4-8', 'C:8-10']);
  assert.equal(byId(o, 'C').response, 5);
});

test('Round Robin: quantum boundaries, new arrivals queue before preempted process', { skip }, async () => {
  const o = await sched('maintenance_scheduler', 'RR', [P('A', 0, 5), P('B', 1, 3), P('C', 2, 1)], 2);
  assert.deepEqual(o.gantt.map((g) => `${g.id}:${g.start}-${g.end}`), ['A:0-2', 'B:2-4', 'C:4-5', 'A:5-7', 'B:7-8', 'A:8-9']);
  assert.equal(byId(o, 'A').completion, 9); assert.equal(byId(o, 'B').completion, 8); assert.equal(byId(o, 'C').completion, 5);
  assert.equal(byId(o, 'C').response, 2);
});

test('Round Robin: quantum larger than every burst behaves like FCFS; quantum 1 is valid', { skip }, async () => {
  const big = await sched('maintenance_scheduler', 'RR', [P('A', 0, 3), P('B', 0, 2)], 100);
  assert.deepEqual(big.sequence, ['A', 'B']);
  const one = await sched('maintenance_scheduler', 'RR', [P('A', 0, 2), P('B', 0, 2)], 1);
  assert.deepEqual(one.sequence, ['A', 'B', 'A', 'B']);
});

test('Round Robin: idle gap then resume', { skip }, async () => {
  const o = await sched('maintenance_scheduler', 'RR', [P('A', 0, 1), P('B', 5, 2)], 3);
  assert.deepEqual(o.gantt.map((g) => `${g.id}:${g.start}-${g.end}`), ['A:0-1', 'IDLE:1-5', 'B:5-7']);
});

test('scheduler: invalid inputs are rejected', { skip }, async () => {
  await rejects(sched('runway_scheduler', 'FCFS', [P('A', 0, 0)]), 'CPP_REJECTED_INPUT');          // burst 0
  await rejects(sched('runway_scheduler', 'FCFS', [P('A', -1, 2)]), 'CPP_REJECTED_INPUT');         // negative arrival
  await rejects(sched('runway_scheduler', 'FCFS', [P('A', 0, 1.5)]), 'CPP_REJECTED_INPUT');        // non-integer
  await rejects(sched('runway_scheduler', 'FCFS', [P('A', 0, 1), P('A', 1, 1)]), 'CPP_REJECTED_INPUT'); // duplicate id
  await rejects(sched('runway_scheduler', 'RR', [P('A', 0, 1)], 2), 'CPP_REJECTED_INPUT');         // algorithm not allowed here
  await rejects(sched('maintenance_scheduler', 'RR', [P('A', 0, 1)], 0), 'CPP_REJECTED_INPUT');    // quantum 0
  await rejects(sched('maintenance_scheduler', 'RR', [P('A', 0, 1)], undefined), 'CPP_REJECTED_INPUT'); // quantum missing
});

// ---------- Banker's algorithm ----------
const ALLOC = [[0, 1, 0], [2, 0, 0], [3, 0, 2], [2, 1, 1], [0, 0, 2]];
const MAX = [[7, 5, 3], [3, 2, 2], [9, 0, 2], [2, 2, 2], [4, 3, 3]];
const bank = (extra, state = {}) => runCpp('bankers_algorithm', { available: [3, 3, 2], allocation: ALLOC, max: MAX, ...state, ...extra });

test('Banker: textbook safe state and sequence', { skip }, async () => {
  const o = await bank({ action: 'safety' });
  assert.equal(o.decision, 'SAFE');
  assert.deepEqual(o.safeSequence, ['P1', 'P3', 'P4', 'P0', 'P2']);
  assert.deepEqual(o.need[0], [7, 4, 3]); // Need = Max - Allocation
});

test('Banker: request granted when safe', { skip }, async () => {
  const o = await bank({ action: 'request', processIndex: 1, request: [1, 0, 2] });
  assert.equal(o.decision, 'GRANTED');
  assert.deepEqual(o.newAvailable, [2, 3, 0]);
  assert.deepEqual(o.newAllocation[1], [3, 0, 2]);
  assert.equal(o.safeSequence.length, 5);
});

test('Banker: unsafe request is denied and rolled back', { skip }, async () => {
  const alloc = ALLOC.map((r, i) => (i === 1 ? [3, 0, 2] : r));
  const o = await bank({ action: 'request', processIndex: 0, request: [0, 2, 0] }, { available: [2, 3, 0], allocation: alloc });
  assert.equal(o.decision, 'DENIED_UNSAFE');
  assert.deepEqual(o.newAvailable, [2, 3, 0]);     // rollback: unchanged
  assert.deepEqual(o.newAllocation, alloc);
  assert.deepEqual(o.safeSequence, []);
});

test('Banker: exceeds Available, exceeds Need, invalid requests', { skip }, async () => {
  assert.equal((await bank({ action: 'request', processIndex: 0, request: [4, 0, 0] })).decision, 'DENIED_EXCEEDS_AVAILABLE');
  assert.equal((await bank({ action: 'request', processIndex: 1, request: [2, 0, 0] })).decision, 'DENIED_EXCEEDS_MAX');
  assert.equal((await bank({ action: 'request', processIndex: 9, request: [1, 0, 0] })).decision, 'INVALID');
  assert.equal((await bank({ action: 'request', processIndex: 0, request: [0, 0, 0] })).decision, 'INVALID');
  assert.equal((await bank({ action: 'request', processIndex: 0, request: [1, 0] })).decision, 'INVALID');
});

test('Banker: unsafe state from safety action; edge cases', { skip }, async () => {
  const unsafe = await bank({ action: 'safety' }, { available: [0, 0, 0] });
  assert.equal(unsafe.decision, 'UNSAFE');
  const none = await runCpp('bankers_algorithm', { action: 'safety', available: [1, 1], allocation: [], max: [] });
  assert.equal(none.decision, 'SAFE'); assert.deepEqual(none.safeSequence, []);
  const zero = await runCpp('bankers_algorithm', { action: 'safety', available: [], allocation: [[], []], max: [[], []] });
  assert.equal(zero.decision, 'SAFE'); assert.equal(zero.safeSequence.length, 2);
  await rejects(bank({ action: 'safety' }, { allocation: [[9, 9, 9]], max: [[1, 1, 1]] }), 'CPP_REJECTED_INPUT'); // allocation > max
  await rejects(bank({ action: 'safety' }, { allocation: [[1, 1]], max: [[2, 2]] }), 'CPP_REJECTED_INPUT');      // wrong width
});

// ---------- Deadlock detection ----------
const detect = (state) => runCpp('deadlock_detection', state);

test('Detection: no deadlock, then genuine deadlock', { skip }, async () => {
  const ok = await detect({ available: [0, 0, 0], allocation: [[0, 1, 0], [2, 0, 0], [3, 0, 3], [2, 1, 1], [0, 0, 2]],
    request: [[0, 0, 0], [2, 0, 2], [0, 0, 0], [1, 0, 0], [0, 0, 2]] }); // Silberschatz example
  assert.equal(ok.result, 'NO_DEADLOCK');
  const bad = await detect({ available: [0, 0, 0], allocation: [[0, 1, 0], [2, 0, 0], [3, 0, 3], [2, 1, 1], [0, 0, 2]],
    request: [[0, 0, 0], [2, 0, 2], [0, 0, 1], [1, 0, 0], [0, 0, 2]] });
  assert.equal(bad.result, 'DEADLOCK');
  assert.deepEqual(bad.unfinished, ['P1', 'P2', 'P3', 'P4']);
});

test('Detection: cycle, idle process holding nothing, recovery after release', { skip }, async () => {
  const cycle = { available: [0, 0, 0], allocation: [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0]], request: [[0, 1, 0], [0, 0, 1], [1, 0, 0], [0, 0, 0]] };
  const d = await detect(cycle);
  assert.equal(d.result, 'DEADLOCK');
  assert.deepEqual(d.unfinished, ['P0', 'P1', 'P2']);
  assert.deepEqual(d.finishable, ['P3']); // holds nothing -> cannot be deadlocked
  const after = await detect({ ...cycle, available: [0, 0, 1], allocation: [[1, 0, 0], [0, 1, 0], [0, 0, 0], [0, 0, 0]] }); // P2 released
  assert.equal(after.result, 'NO_DEADLOCK');
});

test('Detection: multiple-instance outstanding requests', { skip }, async () => {
  const d = await detect({ available: [1, 0], allocation: [[1, 2], [0, 1]], request: [[1, 1], [2, 0]] });
  assert.equal(d.result, 'DEADLOCK'); // P0 needs 1 B (none free); P1 needs 2 A (only 1 free)
});

test('Detection: invalid / insufficient input', { skip }, async () => {
  assert.equal((await detect({ available: [1], allocation: [[1, 1]], request: [[0]] })).result, 'INVALID_STATE');
  assert.equal((await detect({ available: [-1], allocation: [[1]], request: [[0]] })).result, 'INVALID_STATE');
  assert.equal((await detect({ available: [1], allocation: [], request: [] })).result, 'INSUFFICIENT_INFORMATION');
  assert.equal((await detect({ available: [1] })).result, 'INSUFFICIENT_INFORMATION');
});

test('cpp runner: unknown program, malformed output and missing executable are handled', { skip }, async () => {
  await rejects(runCpp('rm -rf /', {}), 'CPP_UNKNOWN');
  const prev = process.env.CPP_BUILD_DIR;
  // build dir is read at module load, so verify missing-exe behaviour in a fresh process
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, ['-e', "require('./backend/lib/cpp').runCpp('bankers_algorithm',{}).catch(e=>console.log(e.code))"],
    { env: { ...process.env, CPP_BUILD_DIR: '/nonexistent' }, cwd: require('path').join(__dirname, '..', '..'), encoding: 'utf8' });
  assert.equal(r.stdout.trim(), 'CPP_MISSING');
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-'));
  fs.writeFileSync(path.join(dir, 'bankers_algorithm'), '#!/bin/sh\necho "not json"\n', { mode: 0o755 });
  const r2 = spawnSync(process.execPath, ['-e', "require('./backend/lib/cpp').runCpp('bankers_algorithm',{}).catch(e=>console.log(e.code))"],
    { env: { ...process.env, CPP_BUILD_DIR: dir }, cwd: require('path').join(__dirname, '..', '..'), encoding: 'utf8' });
  assert.equal(r2.stdout.trim(), 'CPP_BAD_OUTPUT');
  void prev;
});
