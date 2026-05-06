/**
 * Claude Cost Tracker — sync server.
 *
 * Endpoints:
 *   POST /sync       — batch upload of usage entries from a client
 *   GET  /report     — filtered list of entries
 *   GET  /summary    — aggregates (by_day, by_project, by_model, totals)
 *   GET  /health     — health probe (no auth)
 *
 * Auth: X-API-Key header on all endpoints except /health.
 * Multiple keys supported (comma-separated in CLAUDE_COST_API_KEYS) so each
 * machine can have its own.
 */
const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const PORT      = parseInt(process.env.PORT || '5070', 10);
const DB_PATH   = process.env.DB_PATH || path.join(__dirname, 'data', 'cost.sqlite');
const API_KEYS  = (process.env.CLAUDE_COST_API_KEYS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

if (!API_KEYS.length) {
  console.error('FATAL: CLAUDE_COST_API_KEYS env var not set');
  process.exit(1);
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    msg_id          TEXT PRIMARY KEY,
    ts              TEXT NOT NULL,
    date            TEXT NOT NULL,
    client_id       TEXT NOT NULL,
    session_id      TEXT,
    project         TEXT,
    cwd             TEXT,
    model           TEXT,
    input_tokens    INTEGER DEFAULT 0,
    output_tokens   INTEGER DEFAULT 0,
    cache_read      INTEGER DEFAULT 0,
    cache_write_5m  INTEGER DEFAULT 0,
    cache_write_1h  INTEGER DEFAULT 0,
    cost_usd        REAL DEFAULT 0,
    received_at     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
  CREATE INDEX IF NOT EXISTS idx_entries_project ON entries(project);
  CREATE INDEX IF NOT EXISTS idx_entries_model ON entries(model);
  CREATE INDEX IF NOT EXISTS idx_entries_client ON entries(client_id);
`);

const insertEntry = db.prepare(`
  INSERT OR IGNORE INTO entries
  (msg_id, ts, date, client_id, session_id, project, cwd, model,
   input_tokens, output_tokens, cache_read, cache_write_5m, cache_write_1h, cost_usd, received_at)
  VALUES (@msg_id, @ts, @date, @client_id, @session_id, @project, @cwd, @model,
          @input_tokens, @output_tokens, @cache_read, @cache_write_5m, @cache_write_1h, @cost_usd, @received_at)
`);

const insertMany = db.transaction((rows, clientId) => {
  let inserted = 0;
  const now = new Date().toISOString();
  for (const r of rows) {
    if (!r.msg_id) continue;
    const result = insertEntry.run({
      msg_id:         r.msg_id,
      ts:             r.ts || now,
      date:           r.date || now.slice(0, 10),
      client_id:      clientId,
      session_id:     r.session_id || null,
      project:        r.project || null,
      cwd:            r.cwd || null,
      model:          r.model || null,
      input_tokens:   r.input_tokens || 0,
      output_tokens:  r.output_tokens || 0,
      cache_read:     r.cache_read || 0,
      cache_write_5m: r.cache_write_5m || 0,
      cache_write_1h: r.cache_write_1h || 0,
      cost_usd:       r.cost_usd || 0,
      received_at:    now,
    });
    if (result.changes > 0) inserted++;
  }
  return inserted;
});

const app = express();
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const key = req.header('X-API-Key');
  if (!key || !API_KEYS.includes(key)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.clientId = key.slice(0, 8); // first 8 chars as client identifier
  next();
});

app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.post('/sync', (req, res) => {
  const rows = Array.isArray(req.body?.entries) ? req.body.entries : [];
  if (!rows.length) return res.json({ inserted: 0, total_received: 0 });
  const inserted = insertMany(rows, req.clientId);
  res.json({ inserted, total_received: rows.length });
});

app.get('/report', (req, res) => {
  const { from, to, project, model, client_id, limit = 1000 } = req.query;
  const where = [];
  const params = {};
  if (from)      { where.push('date >= @from'); params.from = from; }
  if (to)        { where.push('date <= @to');   params.to = to; }
  if (project)   { where.push('project = @project'); params.project = project; }
  if (model)     { where.push('model = @model'); params.model = model; }
  if (client_id) { where.push('client_id = @client_id'); params.client_id = client_id; }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const lim = Math.min(parseInt(limit) || 1000, 50000);

  const rows = db.prepare(`
    SELECT msg_id, ts, date, session_id, project, cwd, model,
           input_tokens, output_tokens, cache_read, cache_write_5m, cache_write_1h, cost_usd, client_id
    FROM entries
    ${whereSql}
    ORDER BY ts DESC
    LIMIT ${lim}
  `).all(params);

  res.json({ entries: rows, count: rows.length });
});

app.get('/summary', (req, res) => {
  const { from, to } = req.query;
  const where = [];
  const params = {};
  if (from) { where.push('date >= @from'); params.from = from; }
  if (to)   { where.push('date <= @to');   params.to = to; }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(cost_usd), 0) AS total_cost,
      COUNT(*) AS total_requests,
      COALESCE(SUM(input_tokens), 0)  AS total_input,
      COALESCE(SUM(output_tokens), 0) AS total_output,
      COALESCE(SUM(cache_read), 0)    AS total_cache_read
    FROM entries ${whereSql}
  `).get(params);

  const aggBy = (col) => db.prepare(`
    SELECT ${col} AS k, SUM(cost_usd) AS cost, COUNT(*) AS reqs
    FROM entries ${whereSql}
    GROUP BY ${col}
    ORDER BY cost DESC
  `).all(params);

  res.json({
    totals,
    by_day:     aggBy('date'),
    by_project: aggBy('project'),
    by_model:   aggBy('model'),
    by_client:  aggBy('client_id'),
  });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[claude-cost] listening on 127.0.0.1:${PORT}, db=${DB_PATH}, keys=${API_KEYS.length}`);
});
