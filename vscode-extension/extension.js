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
  if (usd < 0.01) return `$${(usd * 100).toFixed(2)}¢`;
  return `$${usd.toFixed(3)}`;
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
  const requests  = data.total_requests || 0;

  statusBarItem.text = `$(circuit-board) ${formatCost(todayCost)}`;
  statusBarItem.tooltip = [
    `Today: ${formatCost(todayCost)}`,
    `All time: ${formatCost(totalCost)}`,
    `Requests: ${requests}`,
    `Last updated: ${data.last_updated || '—'}`,
    '',
    'Click to show breakdown'
  ].join('\n');
  statusBarItem.color = todayCost > 1
    ? new vscode.ThemeColor('statusBarItem.warningForeground')
    : undefined;
}

function showBreakdown() {
  const data = loadData();
  if (!data) {
    vscode.window.showInformationMessage('No Claude cost data yet. Make some requests first.');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    `Today (${today}): ${formatCost(data.by_day?.[today] || 0)}`,
    `All time: ${formatCost(data.total_cost || 0)}`,
    `Total requests: ${data.total_requests || 0}`,
    '',
    'Last 7 days:'
  ];

  const days = Object.keys(data.by_day || {}).sort().slice(-7);
  for (const day of days) {
    lines.push(`  ${day}: ${formatCost(data.by_day[day])}`);
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

function deactivate() {
  watcher?.close();
}

module.exports = { activate, deactivate };
