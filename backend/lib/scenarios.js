// scenarios.js - reproducible demo states for Module D. Resource order is always:
// [Maintenance Bays, Diagnostic Equipment, Baggage Sorting Stations, Ground-Support Equipment].
const RESOURCE_NAMES = ['Maintenance Bays', 'Diagnostic Equipment', 'Baggage Sorting Stations', 'Ground-Support Equipment'];

// Scenario 1 state (identical to database/seed.sql): classic Banker's example plus a 4th resource type.
const BASE = {
  totals: [10, 5, 7, 3],
  processes: ['P0', 'P1', 'P2', 'P3', 'P4'],
  descriptions: ['Engine overhaul crew', 'Cabin inspection crew', 'Cargo transfer crew', 'Avionics crew', 'Baggage reroute crew'],
  alloc: [[0, 1, 0, 0], [2, 0, 0, 1], [3, 0, 2, 0], [2, 1, 1, 0], [0, 0, 2, 0]],
  max: [[7, 5, 3, 1], [3, 2, 2, 1], [9, 0, 2, 0], [2, 2, 2, 1], [4, 3, 3, 0]],
};
const NO_WAIT = (p) => p.processes.map(() => [0, 0, 0, 0]);

// Scenario 3 state: BASE after P1's earlier request (1,0,2,0) was granted.
const AFTER_P1 = { ...BASE, alloc: BASE.alloc.map((r, i) => (i === 1 ? [3, 0, 2, 1] : r)) };

// Scenarios 4/5 state: a genuine deadlock cycle P0 -> P1 -> P2 -> P0 (P3 holds nothing).
const DEADLOCK = {
  totals: [2, 1, 1, 1],
  processes: ['P0', 'P1', 'P2', 'P3'],
  descriptions: ['Engine overhaul crew', 'Baggage reroute crew', 'Cargo transfer crew', 'Idle crew'],
  alloc: [[1, 1, 0, 0], [0, 0, 1, 0], [1, 0, 0, 1], [0, 0, 0, 0]],
  wait: [[0, 0, 1, 0], [0, 0, 0, 1], [0, 1, 0, 0], [0, 0, 0, 0]],
};
DEADLOCK.max = DEADLOCK.alloc.map((row, i) => row.map((x, j) => x + DEADLOCK.wait[i][j]));

const SCENARIOS = {
  1: { title: '1. Safe state with a safe sequence', state: BASE, suggest: { type: 'request', process: 'P1', vector: [1, 0, 2, 0] },
    note: 'P1 asks for (1,0,2,0). Expected: GRANTED, with a safe sequence displayed.' },
  2: { title: '2. Request exceeds Available', state: BASE, suggest: { type: 'request', process: 'P0', vector: [4, 0, 0, 0] },
    note: 'P0 asks for 4 Maintenance Bays but only 3 are free. Expected: DENIED_EXCEEDS_AVAILABLE (process waits).' },
  3: { title: '3. Request leads to an unsafe state', state: AFTER_P1, suggest: { type: 'request', process: 'P0', vector: [0, 2, 0, 0] },
    note: 'Resources are free and within Need, but granting leaves no safe sequence. Expected: DENIED_UNSAFE (rolled back).' },
  4: { title: '4. Genuine deadlock', state: DEADLOCK, suggest: { type: 'detect' },
    note: 'P0, P1, P2 hold resources in a cycle and wait on each other. Expected detection: DEADLOCK (P0,P1,P2).' },
  5: { title: '5. Release lets processes progress', state: DEADLOCK, suggest: { type: 'release', process: 'P2', vector: [0, 0, 0, 1] },
    note: 'Start deadlocked, then P2 releases its Ground-Support unit. Re-run detection: NO_DEADLOCK.' },
  6: { title: '6. Request exceeds declared maximum', state: BASE, suggest: { type: 'request', process: 'P1', vector: [3, 0, 0, 0] },
    note: 'P1 may need only 1 more Bay (Max 3, holds 2). Expected: DENIED_EXCEEDS_MAX.' },
};
for (const s of Object.values(SCENARIOS)) s.state.wait = s.state.wait || NO_WAIT(s.state);

module.exports = { SCENARIOS, RESOURCE_NAMES };
