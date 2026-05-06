# Claude Cost Tracker

Track your Claude API spending across multiple machines. Status bar widget in VSCode, optional self-hosted sync server with per-machine breakdowns.

## Components

```
ClaudeCost/
├── hooks/                  — Claude Code Stop hook (Python)
│   ├── cost_tracker.py     — fires after each response, writes local JSON + pushes to server
│   └── backfill_to_server.py — one-shot backfill of existing local log
│
├── vscode-extension/       — VSCode extension showing status bar + report panel
│   ├── extension.js
│   └── package.json
│
├── server/                 — optional self-hosted sync server (Node.js + SQLite)
│   ├── server.js           — Express API
│   ├── README.md           — server setup
│   └── ecosystem.config.js — PM2 config
│
└── install.sh              — installs hook + extension on a single machine
```

## How it works

```
Claude Code response
        │
        ▼
Stop hook (cost_tracker.py)
        │  reads transcript JSONL, computes cost per model
        ├─► ~/.claude/cost_tracker.json   (summary)
        ├─► ~/.claude/cost_log.jsonl      (detailed log)
        └─► POST sync server (if configured)
                 │
                 ▼
              SQLite on your VPS
                 │
                 ▼
        VSCode webview pulls /report and /summary
```

## Install (client only — local mode)

```bash
git clone https://github.com/kindcasper/ClaudeCost.git
cd ClaudeCost
./install.sh
```

Restart VSCode. Cost shows up in the status bar (bottom-right), click for full report.

## Multi-machine sync (optional)

1. Set up the server — see [server/README.md](server/README.md).
2. Generate one API key per machine with `openssl rand -hex 32`.
3. On each machine, edit `~/.claude/cost_sync.env`:
   ```
   CLAUDE_COST_API_URL=https://your.server/dev/cost
   CLAUDE_COST_API_KEY=that-machine's-key
   ```
4. To backfill existing history:
   ```bash
   python3 ~/.claude/hooks/backfill_to_server.py
   ```

The VSCode report has a Local/Remote toggle and per-client breakdown.

## Pricing

Costs use Anthropic's official API rates per million tokens, per model:

| Model family | Input | Cache 5m | Cache 1h | Cache hit | Output |
|--------------|------:|---------:|---------:|----------:|-------:|
| Opus 4.7 / 4.6 / 4.5 | $5 | $6.25 | $10 | $0.50 | $25 |
| Opus 4.1 / 4 / 3 | $15 | $18.75 | $30 | $1.50 | $75 |
| Sonnet 4.x / 3.7 | $3 | $3.75 | $6 | $0.30 | $15 |
| Haiku 4.5 | $1 | $1.25 | $2 | $0.10 | $5 |
| Haiku 3.5 | $0.80 | $1 | $1.6 | $0.08 | $4 |

The model is detected per-message from the transcript.

> If you're on a Claude Pro / Max / Enterprise subscription, the dollar figures are the API-equivalent cost, not what you actually pay.

## Files at runtime

| Path | Purpose |
|------|---------|
| `~/.claude/hooks/cost_tracker.py` | Stop hook |
| `~/.claude/cost_tracker.json` | Summary (totals, by-day, by-project, by-model) |
| `~/.claude/cost_log.jsonl` | Per-request detailed log |
| `~/.claude/cost_sync.env` | Remote sync config (gitignored) |
| `~/.claude/cost_sync_state.json` | Last successful sync info |
