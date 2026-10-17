# Testing

Environment used: Ubuntu 24.04, Node.js v22, g++ 13.3, **MySQL 8.0.46**. Results below are from actual runs.

## Commands
```bash
npm run build              # compile C++ (prerequisite)
npm run test:algorithms    # 21 tests, no database needed
npm run test:api           # 11 tests, needs MySQL with schema.sql + seed.sql and a valid .env
npm test                   # both
npm run validate           # structure / line-count / scan checks
```
Expected: `# pass 32`, `# fail 0`. **Warning:** `test:api` resets the demo resource tables and adds/removes a few rows; use a development database.

## Actual results
| Suite | Result |
|---|---|
| `algorithms.test.js` | 21 passed, 0 failed |
| `api.test.js` | 11 passed, 0 failed |
| `npm run validate` | file list, line counts and scans pass (see final report) |

## What is covered
**Scheduling:** empty list, single process, idle periods, simultaneous arrivals, equal priorities, FCFS textbook example (avg waiting 16), non-preemptive priority ordering, SRTF preemption/resumption with exact Gantt intervals, preemptive priority, Round Robin (quantum boundaries, arrivals during slices, quantum larger than bursts, quantum 1, idle gap), invalid burst/arrival/duplicate id/wrong algorithm/quantum 0 or missing, and metric values checked by hand.

**Banker's:** textbook safe state and sequence, granted request with new Available/Allocation, unsafe request rolled back (state unchanged), exceeds Available, exceeds Need, invalid requests, unsafe initial state, no processes, zero resource types, allocation > max, wrong matrix width.

**Detection:** no deadlock (textbook example), deadlock (textbook variant), cycle with an idle process holding nothing, recovery after release, multi-instance requests, invalid matrices, insufficient information.

**Backend/database:** CRUD with duplicate (409), validation (400), not found (404); invalid foreign key; restricted delete; scheduling persistence; all six demo scenarios; rollback leaves state and allocations unchanged; waiting-request recording; rejected operations logged; release validation; terminate needs confirmation and returns resources; multi-table transaction rollback; CHECK-constraint rejection; 18 concurrent requests never over-allocate; database down -> 503 `DB_UNAVAILABLE`; missing executables -> 503 `CPP_MISSING`; malformed C++ output -> 502 `CPP_BAD_OUTPUT`; unknown program name refused.

**Frontend (ad hoc, not part of the repository):** the page was loaded in jsdom against the running server. All ten views rendered without script errors, a Round Robin run drew a Gantt chart, and a scenario 3 request, a scenario 4 detection and a demo reset worked through the UI code.

## Not tested / known gaps
- No real-browser testing (Chrome/Firefox/Safari), no visual or responsive layout check, no screen-reader testing.
- Not run on Windows or macOS; the build script is written to be portable but unverified there.
- Only MySQL 8.0.46 was used; other 8.x versions were not tried.
- No load/performance testing beyond the 18-way concurrency test, and no multi-process (several Node servers) concurrency test.
- Rate limiting (600 requests/minute per IP) is configured but not tested.
