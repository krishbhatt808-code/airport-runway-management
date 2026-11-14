# Airport Runway Management System

An academic Operating Systems + DBMS project. A web dashboard (HTML/CSS/vanilla JS) talks to an Express API, which stores data in MySQL and runs the scheduling, Banker's and deadlock-detection algorithms as C++17 programs.

## Prerequisites
- Node.js 18+ and npm
- MySQL 8.x
- A C++17 compiler: `g++` (Linux: `sudo apt install build-essential`; macOS: `xcode-select --install`; Windows: MinGW-w64/MSYS2 `g++` on PATH). Set `CXX` to use another compiler.

## Setup (exact commands)
```bash
# 1. Database (re-running schema.sql drops and recreates all tables)
mysql -u root -p < database/schema.sql
mysql -u root -p < database/seed.sql

# 2. Configuration
cp .env.example .env          # Windows: copy .env.example .env
#    then edit .env: DB_USER, DB_PASSWORD (DB_NAME defaults to airport_runway_db)

# 3. Dependencies and C++ programs
npm install
npm run build                 # compiles backend/*.cpp into build/

# 4. Start
npm start
```
Open **http://localhost:3000** (the Express server serves both the frontend and `/api`, so no CORS setup is needed; change `PORT` in `.env` if 3000 is busy).

The MySQL user needs privileges on `airport_runway_db`. Example:
```sql
CREATE USER 'arm'@'localhost' IDENTIFIED BY 'choose-a-password';
GRANT ALL ON airport_runway_db.* TO 'arm'@'localhost'; 
```

## Useful commands
| Command | Purpose |
|---|---|
| `npm run build` | Compile the five C++ programs |
| `npm test` | All tests (needs MySQL + build) |
| `npm run test:algorithms` | C++ algorithm tests only (no database needed) |
| `npm run validate` | File checks, frontend line counts (max 300), unfinished-marker, absolute-path and credential scan |

## Using the app
1. **Runway / Baggage / Maintenance**: pick an algorithm, press *Run scheduler*. Results (metrics, sequence, Gantt chart) are saved to *Scheduling History*. Records are edited in the same page.
2. **Deadlock Management**: choose a demo scenario, press *Load scenario*, then submit the suggested request/release or *Detect deadlock*. *Reset demo* restores scenario 1. `database/deadlock_demo.sql` loads the deadlock scenario directly from SQL.
3. **Resource Inventory**: manage resource types and processes (with maximum demand).

## Troubleshooting
| Symptom | Fix |
|---|---|
| "Database unavailable" toast / 503 | Start MySQL; check `.env`; make sure `schema.sql` was imported. |
| "Algorithm program ... is not compiled" | Run `npm run build`. Status is shown under *Settings*. |
| `Access denied` | Wrong `DB_USER`/`DB_PASSWORD` in `.env`. |
| Port in use | Set another `PORT` in `.env`. |
| Build fails | Install a C++17 compiler or set `CXX=clang++`. |
| "Inconsistent state" (409) | Counters and allocations disagree (manual SQL edits). Press *Reset demo*. |

## Project layout
See the tree in the root `README.md`. Diagrams and details: `PROJECT_REPORT.md`, `ALGORITHMS.md`, `DATABASE_DESIGN.md`, `TESTING.md`, `VIVA_QUESTIONS.md`.
