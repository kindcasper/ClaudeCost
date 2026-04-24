# Claude Cost Tracker

Shows your Claude API spending in the VSCode status bar, updated automatically after each response.

![Status bar showing Claude cost](https://i.imgur.com/placeholder.png)

## How it works

```
Claude Code response
       │
       ▼
Stop hook fires
       │
       ▼
cost_tracker.py reads transcript JSONL
calculates cost by model & token type
writes → ~/.claude/cost_tracker.json
       │
       ▼
VSCode extension reads the file
updates status bar in real time
```

## Requirements

- macOS / Linux
- Python 3
- VSCode
- [Claude Code](https://claude.ai/code) CLI

## Installation

```bash
git clone <repo-url>
cd ClaudeCost
./install.sh
```

Then **restart VSCode**. The cost tracker appears in the bottom-right status bar.

## Pricing

Costs are calculated using official Anthropic API prices per million tokens:

| Model | Input | Cache 5m write | Cache 1h write | Cache hit | Output |
|-------|------:|---------------:|---------------:|----------:|-------:|
| Claude Opus 4.7 / 4.6 / 4.5 | $5 | $6.25 | $10 | $0.50 | $25 |
| Claude Opus 4.1 / 4 / 3 | $15 | $18.75 | $30 | $1.50 | $75 |
| Claude Sonnet 4.6 / 4.5 / 4 / 3.7 | $3 | $3.75 | $6 | $0.30 | $15 |
| Claude Haiku 4.5 | $1 | $1.25 | $2 | $0.10 | $5 |
| Claude Haiku 3.5 | $0.80 | $1 | $1.6 | $0.08 | $4 |
| Claude Haiku 3 | $0.25 | $0.30 | $0.50 | $0.03 | $1.25 |

The model is detected automatically from the transcript — no configuration needed.

> **Note:** If you're on a Claude Pro / Max / Enterprise subscription, costs shown are the API-equivalent prices, not what you actually pay.

## Usage

- **Click** the status bar item to see a breakdown by day
- **Command palette** → `Claude Cost: Show Breakdown`
- **Command palette** → `Claude Cost: Reset Today's Counter`

## Files

| File | Description |
|------|-------------|
| `hooks/cost_tracker.py` | Claude Code Stop hook — runs after each response |
| `vscode-extension/extension.js` | VSCode extension — reads the JSON and shows status bar |
| `vscode-extension/package.json` | Extension manifest |
| `install.sh` | One-command installer |

## Data file

Stats are stored in `~/.claude/cost_tracker.json`:

```json
{
  "total_cost": 2.49,
  "total_requests": 74,
  "by_day": {
    "2026-04-24": 2.49
  },
  "last_updated": "2026-04-24 09:21 UTC"
}
```

## Uninstall

```bash
rm -rf ~/.vscode/extensions/claude-cost-tracker-0.1.0
rm ~/.claude/hooks/cost_tracker.py
rm ~/.claude/cost_tracker.json
# Remove the "hooks" block from ~/.claude/settings.json
```
