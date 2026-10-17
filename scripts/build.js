// build.js - compiles every backend/*.cpp into build/<name>[.exe] using g++ (or $CXX / clang++).
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'build');
const programs = ['runway_scheduler', 'baggage_scheduler', 'maintenance_scheduler', 'bankers_algorithm', 'deadlock_detection'];
const ext = process.platform === 'win32' ? '.exe' : '';
fs.mkdirSync(out, { recursive: true });

const candidates = [process.env.CXX, 'g++', 'clang++', 'c++'].filter(Boolean);
const compiler = candidates.find((c) => spawnSync(c, ['--version']).status === 0);
if (!compiler) {
  console.error('No C++ compiler found. Install g++ (MinGW-w64 on Windows, build-essential on Linux, Xcode tools on macOS) or set CXX.');
  process.exit(1);
}
let failed = 0;
for (const name of programs) {
  const src = path.join(root, 'backend', name + '.cpp');
  const dst = path.join(out, name + ext);
  const r = spawnSync(compiler, ['-std=c++17', '-O2', '-Wall', '-Wextra', '-o', dst, src], { encoding: 'utf8' });
  if (r.status === 0) console.log(`built  ${name}${ext}`);
  else { failed++; console.error(`FAILED ${name}\n${r.stderr}`); }
}
process.exit(failed ? 1 : 0);
