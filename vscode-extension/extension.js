const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

const COST_FILE = path.join(os.homedir(), '.claude', 'cost_tracker.json');
const LOG_FILE  = path.join(os.homedir(), '.claude', 'cost_log.jsonl');

let statusBarItem;
let watcher;
let panel;

function loadSummary() {
  try {
    if (!fs.existsSync(COST_FILE)) return null;
    return JSON.parse(fs.readFileSync(COST_FILE, 'utf8'));
  } catch { return null; }
}

function loadLog() {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    return fs.readFileSync(LOG_FILE, 'utf8')
      .split('\n').filter(Boolean)
      .map(l => JSON.parse(l));
  } catch { return []; }
}

function formatCost(usd) {
  if (usd < 0.001) return `<$0.001`;
  if (usd < 0.01)  return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function updateStatusBar() {
  const data = loadSummary();
  if (!data) {
    statusBarItem.text = '$(circuit-board) Claude: —';
    statusBarItem.tooltip = 'No Claude cost data yet';
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const todayCost = data.by_day?.[today] || 0;
  statusBarItem.text = `$(circuit-board) ${formatCost(todayCost)}`;
  statusBarItem.tooltip = [
    `Today: ${formatCost(todayCost)}`,
    `All time: ${formatCost(data.total_cost || 0)}`,
    `Requests: ${data.total_requests || 0}`,
    `Updated: ${data.last_updated || '—'}`,
    '', 'Click for full report'
  ].join('\n');
  statusBarItem.color = todayCost > 1
    ? new vscode.ThemeColor('statusBarItem.warningForeground') : undefined;

  if (panel) panel.webview.postMessage({ type: 'refresh', log: loadLog(), summary: data });
}

function getWebviewContent(log, summary) {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const logJson = JSON.stringify(log);
  const summaryJson = JSON.stringify(summary || {});

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Claude Cost Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); font-size: 13px; color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; }
  h1 { font-size: 16px; font-weight: 600; margin-bottom: 16px; color: var(--vscode-foreground); }
  .filters { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; align-items: flex-end; }
  .filter-group { display: flex; flex-direction: column; gap: 4px; }
  label { font-size: 11px; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.5px; }
  input, select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #555); padding: 5px 8px; border-radius: 3px; font-size: 12px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 5px 12px; border-radius: 3px; cursor: pointer; font-size: 12px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
  .card { background: var(--vscode-editor-inactiveSelectionBackground); border: 1px solid var(--vscode-panel-border, #333); border-radius: 6px; padding: 12px 16px; min-width: 140px; }
  .card-label { font-size: 11px; color: var(--vscode-descriptionForeground); text-transform: uppercase; margin-bottom: 4px; }
  .card-value { font-size: 20px; font-weight: 700; color: var(--vscode-foreground); }
  .tabs { display: flex; gap: 0; margin-bottom: 16px; border-bottom: 1px solid var(--vscode-panel-border, #333); }
  .tab { padding: 6px 16px; cursor: pointer; border-bottom: 2px solid transparent; font-size: 12px; color: var(--vscode-descriptionForeground); }
  .tab.active { border-bottom-color: var(--vscode-focusBorder, #007fd4); color: var(--vscode-foreground); }
  .tab-content { display: none; }
  .tab-content.active { display: block; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; padding: 6px 10px; background: var(--vscode-editor-inactiveSelectionBackground); color: var(--vscode-descriptionForeground); font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; cursor: pointer; user-select: none; }
  th:hover { color: var(--vscode-foreground); }
  td { padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a); }
  tr:hover td { background: var(--vscode-list-hoverBackground); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .bar-wrap { display: flex; align-items: center; gap: 8px; }
  .bar { height: 8px; background: var(--vscode-focusBorder, #007fd4); border-radius: 2px; opacity: 0.7; min-width: 2px; }
  .empty { color: var(--vscode-descriptionForeground); padding: 24px; text-align: center; }
  .pagination { display: flex; gap: 8px; align-items: center; margin-top: 12px; font-size: 12px; }
  .pagination button { padding: 3px 8px; }
</style>
</head>
<body>
<h1>$(circuit-board) Claude Cost Report</h1>

<div class="filters">
  <div class="filter-group">
    <label>From</label>
    <input type="date" id="dateFrom" value="${thirtyDaysAgo}">
  </div>
  <div class="filter-group">
    <label>To</label>
    <input type="date" id="dateTo" value="${today}">
  </div>
  <div class="filter-group">
    <label>Project</label>
    <select id="filterProject"><option value="">All projects</option></select>
  </div>
  <div class="filter-group">
    <label>Model</label>
    <select id="filterModel"><option value="">All models</option></select>
  </div>
  <div class="filter-group" style="justify-content:flex-end">
    <label>&nbsp;</label>
    <div style="display:flex;gap:6px">
      <button onclick="setRange('today')">Today</button>
      <button onclick="setRange('7d')">7d</button>
      <button onclick="setRange('30d')">30d</button>
      <button onclick="setRange('all')">All</button>
    </div>
  </div>
</div>

<div class="cards">
  <div class="card"><div class="card-label">Total cost</div><div class="card-value" id="cardCost">—</div></div>
  <div class="card"><div class="card-label">Requests</div><div class="card-value" id="cardReqs">—</div></div>
  <div class="card"><div class="card-label">Output tokens</div><div class="card-value" id="cardOut">—</div></div>
  <div class="card"><div class="card-label">Cache savings</div><div class="card-value" id="cardCache">—</div></div>
</div>

<div class="tabs">
  <div class="tab active" onclick="switchTab('days')">By Day</div>
  <div class="tab" onclick="switchTab('projects')">By Project</div>
  <div class="tab" onclick="switchTab('models')">By Model</div>
  <div class="tab" onclick="switchTab('log')">Raw Log</div>
</div>

<div id="tab-days" class="tab-content active"></div>
<div id="tab-projects" class="tab-content"></div>
<div id="tab-models" class="tab-content"></div>
<div id="tab-log" class="tab-content">
  <div class="pagination">
    <button onclick="prevPage()">‹</button>
    <span id="pageInfo"></span>
    <button onclick="nextPage()">›</button>
  </div>
  <div id="logTable"></div>
</div>

<script>
const RAW_LOG = ${logJson};
const SUMMARY = ${summaryJson};
let filtered = [];
let sortCol = 'ts'; let sortAsc = false;
let logPage = 0; const PAGE = 50;

function fmt(usd) {
  if (usd < 0.001) return '<$0.001';
  if (usd < 0.01)  return '$' + usd.toFixed(4);
  return '$' + usd.toFixed(3);
}
function fmtK(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return String(n);
}

function getFilters() {
  return {
    from:    document.getElementById('dateFrom').value,
    to:      document.getElementById('dateTo').value,
    project: document.getElementById('filterProject').value,
    model:   document.getElementById('filterModel').value,
  };
}

function applyFilters() {
  const f = getFilters();
  filtered = RAW_LOG.filter(r => {
    if (f.from && r.date < f.from) return false;
    if (f.to   && r.date > f.to)   return false;
    if (f.project && r.project !== f.project) return false;
    if (f.model   && r.model   !== f.model)   return false;
    return true;
  });
  logPage = 0;
  render();
}

function setRange(range) {
  const today = new Date().toISOString().slice(0,10);
  document.getElementById('dateTo').value = today;
  if (range === 'today') document.getElementById('dateFrom').value = today;
  else if (range === '7d')  document.getElementById('dateFrom').value = new Date(Date.now()-7*86400000).toISOString().slice(0,10);
  else if (range === '30d') document.getElementById('dateFrom').value = new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  else if (range === 'all') document.getElementById('dateFrom').value = '2024-01-01';
  applyFilters();
}

function aggregate(key) {
  const map = {};
  for (const r of filtered) {
    const k = r[key] || 'unknown';
    if (!map[k]) map[k] = { cost: 0, reqs: 0, output: 0, cache_read: 0 };
    map[k].cost       += r.cost_usd;
    map[k].reqs       += 1;
    map[k].output     += r.output_tokens || 0;
    map[k].cache_read += r.cache_read    || 0;
  }
  return Object.entries(map).sort((a,b) => b[1].cost - a[1].cost);
}

function makeTable(rows, cols) {
  if (!rows.length) return '<div class="empty">No data for selected range</div>';
  const maxCost = Math.max(...rows.map(r => r[1].cost));
  let html = '<table><tr>' + cols.map(c => \`<th>\${c.label}</th>\`).join('') + '</tr>';
  for (const [key, v] of rows) {
    const pct = maxCost > 0 ? (v.cost / maxCost * 120) : 0;
    html += '<tr>' + cols.map(c => {
      if (c.key === 'name') return \`<td>\${key}</td>\`;
      if (c.key === 'bar')  return \`<td><div class="bar-wrap"><div class="bar" style="width:\${pct}px"></div><span>\${fmt(v.cost)}</span></div></td>\`;
      if (c.key === 'reqs') return \`<td class="num">\${v.reqs}</td>\`;
      if (c.key === 'output') return \`<td class="num">\${fmtK(v.output)}</td>\`;
      if (c.key === 'cache') return \`<td class="num">\${fmtK(v.cache_read)}</td>\`;
      return '<td></td>';
    }).join('') + '</tr>';
  }
  return html + '</table>';
}

function render() {
  // Cards
  const total   = filtered.reduce((s,r) => s + r.cost_usd, 0);
  const reqs    = filtered.length;
  const outTok  = filtered.reduce((s,r) => s + (r.output_tokens||0), 0);
  const cacheTok = filtered.reduce((s,r) => s + (r.cache_read||0), 0);
  const PRICES  = { input:3, output:15, cache_read:0.3, cache_write_5m:3.75 };
  const cacheSaved = cacheTok * (PRICES.input - PRICES.cache_read) / 1e6;

  document.getElementById('cardCost').textContent  = fmt(total);
  document.getElementById('cardReqs').textContent  = reqs;
  document.getElementById('cardOut').textContent   = fmtK(outTok);
  document.getElementById('cardCache').textContent = fmt(cacheSaved);

  const cols = [
    { label: 'Name',        key: 'name'   },
    { label: 'Cost',        key: 'bar'    },
    { label: 'Requests',   key: 'reqs'   },
    { label: 'Output tok', key: 'output' },
    { label: 'Cache read', key: 'cache'  },
  ];

  // Days
  document.getElementById('tab-days').innerHTML = makeTable(
    aggregate('date').sort((a,b) => b[0].localeCompare(a[0])), cols
  );

  // Projects
  document.getElementById('tab-projects').innerHTML = makeTable(aggregate('project'), cols);

  // Models
  document.getElementById('tab-models').innerHTML = makeTable(aggregate('model'), cols);

  // Log
  renderLog();
}

function renderLog() {
  const start = logPage * PAGE;
  const page  = filtered.slice(start, start + PAGE);
  document.getElementById('pageInfo').textContent =
    \`\${start+1}–\${Math.min(start+PAGE, filtered.length)} of \${filtered.length}\`;

  if (!page.length) {
    document.getElementById('logTable').innerHTML = '<div class="empty">No data</div>';
    return;
  }
  let html = \`<table><tr>
    <th>Date</th><th>Project</th><th>Model</th>
    <th class="num">Input</th><th class="num">Output</th>
    <th class="num">Cache read</th><th class="num">Cost</th>
  </tr>\`;
  for (const r of page) {
    html += \`<tr>
      <td>\${r.date}</td>
      <td>\${r.project||'—'}</td>
      <td>\${(r.model||'').replace('claude-','')}</td>
      <td class="num">\${fmtK(r.input_tokens||0)}</td>
      <td class="num">\${fmtK(r.output_tokens||0)}</td>
      <td class="num">\${fmtK(r.cache_read||0)}</td>
      <td class="num">\${fmt(r.cost_usd)}</td>
    </tr>\`;
  }
  document.getElementById('logTable').innerHTML = html + '</table>';
}

function prevPage() { if (logPage > 0) { logPage--; renderLog(); } }
function nextPage() { if ((logPage+1)*PAGE < filtered.length) { logPage++; renderLog(); } }

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t,i) => {
    const names = ['days','projects','models','log'];
    t.classList.toggle('active', names[i] === name);
  });
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
}

// Populate filter dropdowns
function initFilters() {
  const projects = [...new Set(RAW_LOG.map(r => r.project).filter(Boolean))].sort();
  const models   = [...new Set(RAW_LOG.map(r => r.model).filter(Boolean))].sort();
  const pSel = document.getElementById('filterProject');
  const mSel = document.getElementById('filterModel');
  projects.forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; pSel.appendChild(o); });
  models.forEach(m => { const o = document.createElement('option'); o.value = m; o.textContent = m.replace('claude-',''); mSel.appendChild(o); });
}

// Events
['dateFrom','dateTo','filterProject','filterModel'].forEach(id =>
  document.getElementById(id).addEventListener('change', applyFilters)
);

// VSCode message (live refresh)
window.addEventListener('message', e => {
  if (e.data.type === 'refresh') {
    RAW_LOG.length = 0;
    RAW_LOG.push(...e.data.log);
    applyFilters();
  }
});

initFilters();
applyFilters();
</script>
</body>
</html>`;
}

function showBreakdown() {
  if (panel) { panel.reveal(); return; }

  panel = vscode.window.createWebviewPanel(
    'claudeCost', 'Claude Cost Report',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  panel.webview.html = getWebviewContent(loadLog(), loadSummary());

  panel.onDidDispose(() => { panel = null; });
}

function resetToday() {
  const data = loadSummary() || {};
  const today = new Date().toISOString().slice(0, 10);
  if (data.by_day) delete data.by_day[today];
  data.total_cost = Object.values(data.by_day || {}).reduce((a, b) => a + b, 0);
  fs.writeFileSync(COST_FILE, JSON.stringify(data, null, 2));
  updateStatusBar();
  vscode.window.showInformationMessage("Today's Claude cost counter reset.");
}

function activate(context) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'claudeCost.showBreakdown';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCost.reset', resetToday),
    vscode.commands.registerCommand('claudeCost.showBreakdown', showBreakdown)
  );

  updateStatusBar();

  const dir = path.dirname(COST_FILE);
  if (fs.existsSync(dir)) {
    watcher = fs.watch(dir, (event, filename) => {
      if (filename === 'cost_tracker.json') updateStatusBar();
    });
    context.subscriptions.push({ dispose: () => watcher?.close() });
  }

  const interval = setInterval(updateStatusBar, 30000);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });
}

function deactivate() { watcher?.close(); }

module.exports = { activate, deactivate };
