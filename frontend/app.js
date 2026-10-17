'use strict';
// Frontend: the server makes every scheduling/resource decision; this file only renders. No innerHTML is used anywhere.

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'class') n.className = v;
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...kids.flat().filter((x) => x != null && x !== false).map((x) => (x.nodeType ? x : String(x))));
  return n;
};
const human = (s) => String(s).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const clear = (n) => { n.replaceChildren(); return n; };
const acr = (name) => name.split(/[\s-]+/).map((w) => w[0]).join('');
const fmtTime = (v) => (v ? new Date(v).toLocaleString() : '–');
const LEVEL = { GRANTED: 'ok', SAFE: 'ok', NO_DEADLOCK: 'ok', RELEASED: 'ok', TERMINATED: 'ok', DENIED_EXCEEDS_AVAILABLE: 'warn', DENIED_UNSAFE: 'warn',
  UNSAFE: 'warn', INSUFFICIENT_INFORMATION: 'warn', DENIED_EXCEEDS_MAX: 'bad', DENIED_OFFLINE: 'bad', INVALID: 'bad', DEADLOCK: 'bad', INVALID_STATE: 'bad' };
const badge = (v) => el('span', { class: `badge ${LEVEL[v] || 'info'}` }, human(v));

let pending = 0;
function busy(d) { pending += d; $('#progress').classList.toggle('on', pending > 0); }
function toast(msg, kind = 'ok') {
  const t = el('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 4500);
}
async function api(path, method = 'GET', body) {
  busy(1);
  try {
    const res = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    if (!json || !res.ok || !json.ok) throw new Error(json?.error?.message || 'The server returned an unexpected response.');
    return json.data;
  } catch (e) {
    toast(e instanceof TypeError ? 'Cannot reach the server. Is it running?' : e.message, 'error');
    throw e;
  } finally { busy(-1); }
}
const safe = (fn) => async (...a) => { try { await fn(...a); } catch (_) { /* api() already showed a toast */ } };
const cols = (...keys) => keys.map((k) => [k, human(k)]);
function table(columns, rows, actions, empty = 'Nothing here yet.') {
  if (!rows.length) return el('p', { class: 'empty' }, empty);
  return el('div', { class: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {}, columns.map((c) => el('th', { scope: 'col' }, c[1])), actions ? el('th', { scope: 'col' }, 'Actions') : null)),
    el('tbody', {}, rows.map((r) => el('tr', {},
      columns.map((c) => el('td', {}, c[2] ? c[2](r[c[0]], r) : r[c[0]] ?? '–')),
      actions ? el('td', { class: 'acts' }, actions(r)) : null)))));
}
function field(f, value) {
  const input = Array.isArray(f.type)
    ? el('select', { name: f.name }, f.type.map((o) => el('option', { value: o, selected: o === value }, human(o))))
    : el('input', { type: f.type, name: f.name, min: f.min, max: f.max, step: f.type === 'number' ? 1 : null, required: !f.opt, value: value ?? '' });
  return el('label', {}, f.label || human(f.name), input);
}
const fld = (name, type = 'text', o = {}) => ({ name, type, ...o });
const num = (name, min, o = {}) => fld(name, 'number', { min, ...o });
// crud(root, cfg): list + add/edit form + delete for one REST resource. Returns a redraw function.
function crud(root, cfg) {
  let editRow = null;
  const draw = safe(async () => {
    if (cfg.prep) await cfg.prep();
    const rows = await api(cfg.path);
    const id = editRow && editRow[cfg.id];
    const form = el('form', { class: 'row form-grid', onsubmit: safe(async (e) => {
      e.preventDefault();
      await api(id ? `${cfg.path}/${id}` : cfg.path, id ? 'PUT' : 'POST', Object.fromEntries(new FormData(form)));
      toast(id ? 'Changes saved.' : 'Record added.');
      editRow = null;
      draw();
    }) }, cfg.fields().map((f) => field(f, editRow?.[f.name])),
    el('button', { class: 'btn primary', type: 'submit' }, id ? 'Save changes' : 'Add record'),
    id ? el('button', { class: 'btn', type: 'button', onclick: () => { editRow = null; draw(); } }, 'Cancel') : null);
    const actions = (r) => [
      el('button', { class: 'btn sm', onclick: () => { editRow = r; draw(); } }, 'Edit'),
      el('button', { class: 'btn sm danger', onclick: safe(async () => {
        if (!confirm('Delete this record?')) return;
        await api(`${cfg.path}/${r[cfg.id]}`, 'DELETE');
        toast('Record deleted.');
        draw();
      }) }, 'Delete')];
    clear(root).append(el('h2', {}, cfg.title), form, table(cols(cfg.id, ...cfg.fields().map((f) => f.name), ...(cfg.extra || [])), rows, actions, `No ${cfg.title.toLowerCase()} yet. Use the form above to add one.`));
  });
  return draw;
}
let RES = []; // resource types, used by the process form
const CRUD = { // columns default to: id + form fields + 'extra' (joined columns from the API)
  aircraft: { path: '/aircraft', title: 'Aircraft', id: 'aircraft_id',
    fields: () => [fld('registration'), fld('model'), fld('airline'), fld('status', ['ACTIVE', 'IN_MAINTENANCE', 'RETIRED'])] },
  flights: { path: '/flights', title: 'Flights', id: 'flight_id', extra: ['registration'],
    fields: () => [fld('flight_number'), num('aircraft_id', 1, { label: 'Aircraft ID' }), num('runway_id', 1, { label: 'Runway ID (optional)', opt: true }),
      fld('operation', ['ARRIVAL', 'DEPARTURE']), num('arrival_time', 0), num('burst_time', 1), num('priority', 1, { max: 99 })] },
  baggage: { path: '/baggage-batches', title: 'Baggage batches', id: 'batch_id', extra: ['flight_number'],
    fields: () => [num('flight_id', 1, { label: 'Flight ID' }), num('bag_count', 0), num('arrival_time', 0), num('burst_time', 1), num('priority', 1, { max: 99 })] },
  tasks: { path: '/maintenance-tasks', title: 'Maintenance tasks', id: 'task_id', extra: ['registration'],
    fields: () => [num('aircraft_id', 1, { label: 'Aircraft ID' }), fld('description'), num('arrival_time', 0), num('burst_time', 1), num('priority', 1, { max: 99 }),
      fld('status', ['PENDING', 'COMPLETED'])] },
  runways: { path: '/runways', title: 'Runways', id: 'runway_id',
    fields: () => [fld('name'), num('length_m', 500, { max: 6000, label: 'Length (m)' }), fld('status', ['ACTIVE', 'CLOSED', 'MAINTENANCE'])] },
  resources: { path: '/resources', title: 'Resource types', id: 'resource_id', extra: ['allocated_instances', 'available_instances'],
    fields: () => [fld('name'), num('total_instances', 0), fld('status', ['ONLINE', 'OFFLINE'])] },
  processes: { path: '/processes', title: 'Processes and maximum demand', id: 'process_id', prep: async () => { RES = await api('/resources'); }, extra: ['status'],
    fields: () => [fld('name'), fld('description', 'text', { opt: true }), ...RES.map((r) => num('max_' + r.resource_id, 0, { label: 'Max ' + r.name }))] },
};
function gantt(slices) {
  if (!slices.length) return el('p', { class: 'empty' }, 'Nothing was scheduled.');
  const ids = [...new Set(slices.map((s) => s.id).filter((i) => i !== 'IDLE'))];
  return el('div', { class: 'gantt', role: 'img', 'aria-label': 'Gantt chart of the execution timeline' }, slices.map((s, i) => {
    const idle = s.id === 'IDLE';
    const bar = el('div', { class: idle ? 'bar idle' : 'bar', title: `${s.id}: ${s.start} to ${s.end}` }, idle ? 'idle' : s.id);
    if (!idle) bar.style.background = `hsl(${(ids.indexOf(s.id) * 47) % 360} 55% 38%)`;
    const seg = el('div', { class: 'seg' }, bar, el('span', { class: 't' }, s.start), i === slices.length - 1 ? el('span', { class: 't end' }, s.end) : null);
    seg.style.flex = `${s.end - s.start} 0 44px`;
    return seg;
  }));
}
function showResult(root, d) {
  root.hidden = false;
  const mini = (label, v) => el('div', { class: 'stat-mini' }, el('b', {}, v), el('span', {}, label));
  const seq = d.gantt.filter((g) => g.id !== 'IDLE').map((g) => g.id).join(' → ') || 'none';
  clear(root).append(
    el('h2', {}, `${human(d.algorithm)}${d.quantum ? ` (quantum ${d.quantum})` : ''}${d.runId || d.run_id ? `, run #${d.runId || d.run_id}` : ''}`),
    el('div', { class: 'mini-row' }, mini('Average waiting', d.averages.waiting), mini('Average turnaround', d.averages.turnaround), mini('Average response', d.averages.response), mini('Total simulated time', d.totalTime)),
    el('p', {}, el('strong', {}, 'Execution sequence: '), seq), gantt(d.gantt),
    table(cols('id', 'arrival', 'burst', 'priority', 'start', 'completion', 'turnaround', 'waiting', 'response'), d.results, null, 'No records to schedule. Add some below first.'));
}
// ---------- scheduling module views (runway, baggage, maintenance) ----------
const SCHED = {
  runway: { title: 'Runway Allocation', algos: ['FCFS', 'PRIORITY_NP'], crud: 'flights',
    intro: 'One runway, non-preemptive scheduling: once an aircraft starts its runway operation it is never interrupted. Priority 1 is most urgent; ties go to the earlier arrival, then input order.' },
  baggage: { title: 'Baggage Sorting', algos: ['SRTF', 'PRIORITY_P'], crud: 'baggage',
    intro: 'Each flight\'s baggage batch is a process. Preemptive scheduling: a shorter (SRTF) or more urgent (priority) batch interrupts the sorter, and the interrupted batch resumes later with its remaining time.' },
  maintenance: { title: 'Aircraft Maintenance', algos: ['PRIORITY_P', 'RR'], crud: 'tasks',
    intro: 'Urgent tasks get a smaller priority number and interrupt less urgent ones; Round Robin shares the crew in equal time slices (the quantum). Interrupted tasks keep their remaining time.',
    warn: 'Academic simulation only. It models CPU-style scheduling and is not guidance to interrupt real safety-critical maintenance work.' },
};
function schedView(name) {
  const cfg = SCHED[name];
  let redraw = null;
  return () => {
    if (!redraw) {
      const root = $(`#view-${name}`);
      root.append($('#tpl-sched').content.cloneNode(true));
      $('h1', root).textContent = cfg.title;
      $('.intro', root).textContent = cfg.intro;
      if (cfg.warn) $('.intro', root).after(el('div', { class: 'warning' }, cfg.warn));
      const form = $('[data-role=run]', root);
      form.elements.algorithm.append(...cfg.algos.map((a) => el('option', { value: a }, human(a))));
      form.elements.algorithm.addEventListener('change', () => { $('[data-role=q]', root).hidden = form.elements.algorithm.value !== 'RR'; });
      form.addEventListener('submit', safe(async (e) => {
        e.preventDefault();
        const body = { algorithm: form.elements.algorithm.value };
        if (body.algorithm === 'RR') body.quantum = Number(form.elements.quantum.value);
        showResult($('[data-role=result]', root), await api(`/schedule/${name}`, 'POST', body));
      }));
      redraw = crud($('[data-role=records]', root), CRUD[cfg.crud]);
    }
    redraw();
  };
}
function bars(root, title, items, empty) {
  const row = ([label, value, max, text]) => {
    const fill = el('div', { class: 'bar-fill' });
    fill.style.width = `${max ? Math.min(100, (value / max) * 100) : 0}%`;
    return el('div', { class: 'bar-row' }, el('span', {}, label), el('div', { class: 'bar-track' }, fill), el('span', {}, text ?? value));
  };
  clear(root).append(el('h2', {}, title), ...(items.length ? items.map(row) : [el('p', { class: 'empty' }, empty)]));
}
const STATS = [['aircraft', 'Aircraft'], ['flights', 'Flights'], ['runways', 'Runways'], ['availableResources', 'Free resource units'], ['pendingTasks', 'Pending maintenance tasks'],
  ['completedRuns', 'Scheduling runs completed'], ['safeRequests', 'Resource requests granted'], ['deadlockIncidents', 'Deadlocks detected']];
const drawDashboard = safe(async () => {
  const d = await api('/dashboard');
  clear($('#stats')).append(...STATS.map(([k, label]) => el('div', { class: k === 'deadlockIncidents' && d[k] > 0 ? 'stat bad' : 'stat' }, el('b', {}, d[k]), el('span', {}, label))));
  const top = Math.max(1, ...d.runsByAlgorithm.map((r) => r.runs));
  bars($('#chart-algos'), 'Scheduling runs by algorithm', d.runsByAlgorithm.map((r) => [human(r.algorithm), r.runs, top]), 'No scheduling runs yet. Run a scheduler to see counts here.');
  bars($('#chart-res'), 'Resource availability', d.resources.map((r) => [r.name, r.available_instances, r.total_instances, `${r.available_instances} / ${r.total_instances}`]), 'No resource types defined.');
  clear($('#recent')).append(el('h2', {}, 'Recent scheduling runs'),
    table([...cols('run_id', 'module', 'algorithm', 'process_count', 'avg_waiting'), ['created_at', 'Time', fmtTime]], d.recentRuns, null, 'No runs yet.'));
});
const drawHistory = safe(async () => {
  const m = $('#hist-filter').value;
  const rows = await api('/runs' + (m ? `?module=${m}` : ''));
  const actions = (r) => [
    el('button', { class: 'btn sm', onclick: safe(async () => { showResult($('#hist-detail'), await api(`/runs/${r.run_id}`)); }) }, 'View'),
    el('button', { class: 'btn sm danger', onclick: safe(async () => { if (confirm('Delete this run?')) { await api(`/runs/${r.run_id}`, 'DELETE'); $('#hist-detail').hidden = true; drawHistory(); } }) }, 'Delete')];
  clear($('#hist-table')).append(table([...cols('run_id', 'module', 'algorithm', 'process_count', 'avg_waiting', 'avg_turnaround', 'avg_response', 'total_time'), ['created_at', 'Time', fmtTime]],
    rows, actions, 'No scheduling runs saved yet.'));
});
const drawReports = safe(async () => {
  const d = await api('/reports');
  const top = Math.max(1, ...d.perAlgorithm.map((r) => r.avg_waiting));
  bars($('#rep-algos'), 'Average waiting time by algorithm (all saved runs)', d.perAlgorithm.map((r) => [`${human(r.module)} ${r.algorithm}`, r.avg_waiting, top, `${r.avg_waiting} (${r.runs} runs)`]), 'Run a scheduler to build this report.');
  clear($('#rep-decisions')).append(el('h2', {}, 'Resource decisions'), table([['txn_type', 'Type'], ['decision', 'Decision', badge], ['count', 'Count']], d.decisions, null, 'No resource activity yet.'));
  clear($('#rep-checks')).append(el('h2', {}, 'Deadlock checks'), table([['result', 'Result', badge], ['count', 'Count']], d.deadlockChecks, null, 'No checks yet.'));
});
const drawHealth = async () => {
  const d = (await fetch('/api/health').then((r) => r.json()).catch(() => null))?.data;
  const chip = (ok, text) => el('span', { class: `badge ${ok ? 'ok' : 'bad'}` }, text);
  clear($('#health')).append(el('h2', {}, 'System status'), ...(d ? [el('p', {}, 'Database: ', chip(d.database, d.database ? 'connected' : 'unavailable: check .env and MySQL')),
    el('p', {}, 'C++ programs: ', Object.entries(d.executables).flatMap(([n, ok]) => [chip(ok, ok ? n : `${n} missing: run npm run build`), ' ']))]
    : [el('p', { class: 'empty' }, 'Cannot reach the server.')]));
};
// ---------- deadlock management view ----------
let DS = null; // latest server snapshot
const vec = (form) => DS.resources.map((_, j) => Number(form.elements[`r${j}`].value || 0));
const out = (id, decision, ...lines) => clear($(id)).append(el('div', { class: 'result' }, badge(decision), lines.filter(Boolean).map((l) => el('p', {}, l))));
function matrix(title, rows, procs, names) {
  return el('div', {}, el('h3', {}, title), table([['p', 'Process'], ...names.map((n, j) => [j, acr(n)])], rows.map((r, i) => ({ p: procs[i], ...r }))));
}
const drawDeadlock = safe(async () => {
  DS = await api('/state');
  const names = DS.resources.map((r) => r.name);
  const procs = DS.processes.map((p) => p.name);
  clear($('#dl-state')).append(el('h2', {}, 'Resource snapshot'),
    table([['name', 'Resource'], ['total_instances', 'Total'], ['allocated_instances', 'Allocated'], ['available_instances', 'Available'], ['status', 'Status']], DS.resources),
    el('p', {}, el('strong', {}, 'Available vector: '), `(${DS.available.join(', ')})`, `   Columns: ${names.map((n) => `${acr(n)} = ${n}`).join('; ')}`),
    el('div', { class: 'grid-2' }, matrix('Allocation', DS.allocation, procs, names), matrix('Maximum demand', DS.max, procs, names),
      matrix('Need = Max - Allocation', DS.need, procs, names), matrix('Outstanding (waiting) requests', DS.request, procs, names)));
  for (const f of ['#req-form', '#rel-form']) {
    const form = $(f);
    clear(form.elements.process).append(...DS.processes.map((p) => el('option', { value: p.process_id }, `${p.name}: ${p.description}`)));
    clear($('[data-vec]', form)).append(...names.map((n, j) => el('label', {}, acr(n), el('input', { type: 'number', name: `r${j}`, min: 0, value: 0, title: n, 'aria-label': n }))));
  }
  const t = await api('/transactions');
  clear($('#dl-txn')).append(el('h2', {}, 'Resource transaction history'), table([['txn_id', 'ID'], ['created_at', 'Time', fmtTime], ['process_name', 'Process'], ['txn_type', 'Type'],
    ['decision', 'Decision', badge], ['message', 'Message']], t, null, 'No resource transactions yet.'));
});
function showDetection(d) {
  const mat = d.request?.length ? matrix('Outstanding requests checked', d.request, d.processes, d.resourceNames) : null;
  clear($('#dl-detect')).append(el('div', { class: 'result' }, el('h3', {}, 'Deadlock detection'), badge(d.result), el('p', {}, d.explanation),
    el('p', {}, el('strong', {}, 'Finishable: '), d.finishable.join(', ') || 'none'), el('p', {}, el('strong', {}, 'Unfinished: '), d.unfinished.join(', ') || 'none'), mat));
}
function initDeadlock() {
  api('/demo/scenarios').then((list) => $('#scenario').append(...list.map((s) => el('option', { value: s.id }, s.title))));
  const load = (path, body) => safe(async () => {
    const r = await api(path, 'POST', body);
    $('#scn-note').textContent = `${r.title}. ${r.note}`;
    const s = r.suggest;
    clear($('#dl-out')).append(el('p', { class: 'empty' }, s.type === 'detect' ? 'Press "Detect deadlock" to analyse this state.'
      : `Suggested action: ${s.type} (${s.vector.join(', ')}) for ${s.process}. Select ${s.process} and enter those quantities.`));
    clear($('#dl-detect'));
    await drawDeadlock();
  });
  $('#load-scn').addEventListener('click', () => load('/demo/init', { scenario: Number($('#scenario').value) })());
  $('#reset-scn').addEventListener('click', () => load('/demo/reset', {})());
  $('#req-form').addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    const f = e.target;
    const r = await api('/resources/request', 'POST', { processId: Number(f.elements.process.value), request: vec(f), queueIfDenied: f.elements.queue.checked });
    out('#dl-out', r.decision, `${r.process} requested (${r.request.join(', ')}).`, r.explanation, r.safeSequence.length ? `Safe sequence: ${r.safeSequence.join(' → ')}` : '');
    drawDeadlock();
  }));
  $('#btn-safety').addEventListener('click', safe(async () => {
    const r = await api('/bankers/safety', 'POST', {});
    out('#dl-out', r.decision, r.explanation, r.safeSequence.length ? `Safe sequence: ${r.safeSequence.join(' → ')}` : '');
  }));
  $('#rel-form').addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    const r = await api('/resources/release', 'POST', { processId: Number(e.target.elements.process.value), release: vec(e.target) });
    out('#dl-out', 'RELEASED', `${r.process} released (${r.release.join(', ')}). Available is now (${r.newAvailable.join(', ')}).`,
      r.waitingRequestsNowSatisfiable.length ? `Waiting requests that now fit: ${r.waitingRequestsNowSatisfiable.join(', ')}` : '');
    showDetection(r.detection);
    drawDeadlock();
  }));
  $('#btn-term').addEventListener('click', safe(async () => {
    const sel = $('#rel-form').elements.process;
    if (!confirm(`Terminate simulated process ${sel.selectedOptions[0].textContent.split(':')[0]}? Its resources will be released.`)) return;
    const r = await api(`/processes/${sel.value}/terminate`, 'POST', { confirm: true });
    out('#dl-out', 'TERMINATED', `${r.process} terminated. Released (${r.released.join(', ')}). Recorded as a recovery action.`);
    showDetection(r.detection);
    drawDeadlock();
  }));
  $('#btn-detect').addEventListener('click', safe(async () => { showDetection(await api('/deadlock/detect', 'POST', {})); }));
}
const draws = {};
const once = (key, name, root) => { draws[key] = draws[key] || crud($(root), CRUD[name]); draws[key](); };
const views = {
  dashboard: drawDashboard, runway: schedView('runway'), baggage: schedView('baggage'), maintenance: schedView('maintenance'), deadlock: drawDeadlock,
  inventory: () => { once('res', 'resources', '#crud-resources'); once('proc', 'processes', '#crud-processes'); },
  records: () => { once('air', 'aircraft', '#crud-aircraft'); once('fl', 'flights', '#crud-flights'); },
  history: drawHistory, reports: drawReports, settings: () => { drawHealth(); once('rw', 'runways', '#crud-runways'); },
};
function route() {
  const name = views[location.hash.slice(1)] ? location.hash.slice(1) : 'dashboard';
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  document.querySelectorAll('#nav a').forEach((a) => (a.getAttribute('href') === `#${name}` ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  document.body.classList.remove('menu-open');
  $('#menu-btn').setAttribute('aria-expanded', 'false');
  views[name]();
}
$('#menu-btn').addEventListener('click', () => {
  const open = document.body.classList.toggle('menu-open');
  $('#menu-btn').setAttribute('aria-expanded', String(open));
});
$('#hist-filter').addEventListener('change', drawHistory);
window.addEventListener('hashchange', route);
initDeadlock();
route();