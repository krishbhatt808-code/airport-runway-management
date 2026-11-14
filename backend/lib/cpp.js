// cpp.js - safely runs the compiled C++ algorithm programs.
// Only names in ALLOWED can run (no user-controlled command or path). Input/output is JSON on stdin/stdout.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { AppError } = require('./http');

const ALLOWED = ['runway_scheduler', 'baggage_scheduler', 'maintenance_scheduler', 'bankers_algorithm', 'deadlock_detection'];
const BUILD_DIR = process.env.CPP_BUILD_DIR || path.join(__dirname, '..', '..', 'build');
const exePath = (name) => path.join(BUILD_DIR, name + (process.platform === 'win32' ? '.exe' : ''));
const MAX_OUTPUT = 5 * 1024 * 1024;

function executableStatus() {
  return Object.fromEntries(ALLOWED.map((n) => [n, fs.existsSync(exePath(n))]));
}

function runCpp(name, input, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (!ALLOWED.includes(name)) return reject(new AppError(500, 'Unknown algorithm program.', 'CPP_UNKNOWN'));
    const exe = exePath(name);
    if (!fs.existsSync(exe)) {
      return reject(new AppError(503, `Algorithm program '${name}' is not compiled. Run: npm run build`, 'CPP_MISSING'));
    }
    const child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true });
    let out = '';
    let tooBig = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => {
      out += d;
      if (out.length > MAX_OUTPUT) { tooBig = true; child.kill('SIGKILL'); }
    });
    child.on('error', () => { clearTimeout(timer); reject(new AppError(503, `Could not start '${name}'. Rebuild with: npm run build`, 'CPP_START_FAILED')); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (tooBig) return reject(new AppError(502, 'Algorithm output too large.', 'CPP_BAD_OUTPUT'));
      let parsed;
      try { parsed = JSON.parse(out); } catch (_) {
        return reject(new AppError(502, `Algorithm '${name}' returned malformed output.`, 'CPP_BAD_OUTPUT'));
      }
      if (code === 2 && parsed && parsed.error) return reject(new AppError(400, parsed.error, 'CPP_REJECTED_INPUT'));
      if (code !== 0) return reject(new AppError(502, `Algorithm '${name}' failed (exit ${code}).`, 'CPP_FAILED'));
      resolve(parsed);
    });
    child.stdin.on('error', () => {}); // ignore EPIPE if the child exits early
    child.stdin.end(JSON.stringify(input));
  });
}

module.exports = { runCpp, executableStatus, ALLOWED };
