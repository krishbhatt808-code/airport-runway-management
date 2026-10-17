# Airport Runway Management System

Academic project demonstrating OS scheduling (FCFS, Priority, SRTF, Round Robin), Banker's algorithm and deadlock detection, backed by MySQL, with C++17 algorithms called from a Node/Express API and a three-file vanilla-JS dashboard.

```text
airport-runway-management/
├── frontend/   index.html, style.css, app.js        (each <= 300 lines)
├── backend/    server.js, lib/, routes/, 5 x *.cpp, include/, tests/
├── database/   schema.sql, seed.sql, deadlock_demo.sql
├── docs/       README, PROJECT_REPORT, ALGORITHMS, DATABASE_DESIGN, TESTING, VIVA_QUESTIONS
├── scripts/    build.js (compile C++), validate.js (checks + line counts)
└── .env.example, .gitignore, package.json
```

Quick start (full instructions in [docs/README.md](docs/README.md)):
```bash
mysql -u root -p < database/schema.sql && mysql -u root -p < database/seed.sql
cp .env.example .env     # edit DB_USER / DB_PASSWORD
npm install && npm run build && npm start     # open http://localhost:3000
```
This is an educational simulation; it must not be used for real flight or maintenance operations.
