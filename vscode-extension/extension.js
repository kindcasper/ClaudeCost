const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

const COST_FILE = path.join(os.homedir(), '.claude', 'cost_tracker.json');

let statusBarItem;
let watcher;

function loadData() {
  try {
    if (!fs.existsSync(COST_FILE)) return null;
    return JSON.parse(fs.readFileSync(COST_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function formatCost(usd) {
  if (usd < 0.001) return `<$0.001`;
  if (usd < 0.01)  return `$${(usd).toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function topEntries(obj, n = 5) {
  return Object.entries(obj || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

function updateStatusBar() {
  const data = loadData();
  if (!data) {
    statusBarItem.text = '$(circuit-board) Claude: —';
    statusBarItem.tooltip = 'No Claude cost data yet';
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayCost = data.by_day?.[today] || 0;
  const totalCost = data.total_cost || 0;

  statusBarItem.text = `$(circuit-board) ${formatCost(todayCost)}`;
  statusBarItem.tooltip = [
    `Today: ${formatCost(todayCost)}`,
    `All time: ${formatCost(totalCost)}`,
    `Requests: ${data.total_requests || 0}`,
    `Updated: ${data.last_updated || '—'}`,
    '',
    'Click for full breakdown'
  ].join('\n');
  statusBarItem.color = todayCost > 1
    ? new vscode.ThemeColor('statusBarItem.warningForeground')
    : undefined;
}

function showBreakdown() {
  const data = loadData();
  if (!data) {
    vscode.window.showInformationMessage('No Claude cost data yet.');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const lines = [];

  lines.push(`TODAY (${today}): ${formatCost(data.by_day?.[today] || 0)}`);
  lines.push(`ALL TIME: ${formatCost(data.total_cost || 0)}  |  Requests: ${data.total_requests || 0}`);
  lines.push('');

  // Last 7 days
  const days = Object.keys(data.by_day || {}).sort().slice(-7);
  if (days.length) {
    lines.push('LAST 7 DAYS:');
    for (const day of days.reverse()) {
      lines.push(`  ${day}: ${formatCost(data.by_day[day])}`);
    }
    lines.push('');
  }

  // By project
  const projects = topEntries(data.by_project);
  if (projects.length) {
    lines.push('BY PROJECT (top 5):');
    for (const [name, cost] of projects) {
      lines.push(`  ${name}: ${formatCost(cost)}`);
    }
    lines.push('');
  }

  // By model
  const models = topEntries(data.by_model);
  if (models.length) {
    lines.push('BY MODEL:');
    for (const [model, cost] of models) {
      lines.push(`  ${model}: ${formatCost(cost)}`);
    }
  }

  vscode.window.showInformationMessage(lines.join('\n'), { modal: true }, 'Reset Today')
    .then(choice => { if (choice === 'Reset Today') resetToday(); });
}

function resetToday() {
  const data = loadData() || {};
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
