// validate.js - pre-packaging checks: required files, frontend line counts (max 300), and forbidden-content scan.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const required = ['frontend/index.html', 'frontend/style.css', 'frontend/app.js', 'backend/server.js', 'backend/runway_scheduler.cpp',
  'backend/baggage_scheduler.cpp', 'backend/maintenance_scheduler.cpp', 'backend/bankers_algorithm.cpp', 'backend/deadlock_detection.cpp',
  'database/schema.sql', 'database/seed.sql', 'database/deadlock_demo.sql', 'docs/README.md', 'docs/PROJECT_REPORT.md', 'docs/ALGORITHMS.md',
  'docs/DATABASE_DESIGN.md', 'docs/TESTING.md', 'docs/VIVA_QUESTIONS.md', '.env.example', '.gitignore', 'package.json', 'README.md'];
let problems = 0;
const fail = (m) => { problems++; console.error('FAIL ' + m); };

for (const f of required) if (!fs.existsSync(path.join(root, f))) fail('missing ' + f);

console.log('Frontend line counts (limit 300):');
for (const f of ['index.html', 'style.css', 'app.js']) {
  const n = fs.readFileSync(path.join(root, 'frontend', f), 'utf8').split('\n').length - 1;
  console.log(`  ${f.padEnd(11)} ${n}`);
  if (n > 300) fail(`${f} has ${n} lines`);
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'build', '.git'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
const rules = [[/\bTODO\b|\bFIXME\b/, 'unfinished marker'], [/\/home\/|C:\\Users\\/, 'absolute local path'], [/DB_PASSWORD\s*=\s*\S+/, 'hardcoded password']];
for (const file of walk(root)) {
  const rel = path.relative(root, file);
  if (rel === '.env' || rel.startsWith('scripts/validate.js') || rel.startsWith('backend/tests/') || !/\.(js|cpp|h|sql|html|css|md|json)$/.test(rel)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const [re, label] of rules) {
    if (rel === '.env.example' && label === 'hardcoded password') continue;
    if (re.test(text)) fail(`${label} in ${rel}`);
  }
}
if (fs.existsSync(path.join(root, '.env'))) console.log('NOTE .env exists locally (it is excluded from the ZIP).');
console.log(problems ? `\n${problems} problem(s) found.` : '\nAll checks passed.');
process.exit(problems ? 1 : 0);
