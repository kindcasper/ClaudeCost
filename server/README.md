# Claude Cost Sync Server

Tiny Node.js + SQLite sync server for Claude Cost Tracker. Lets multiple machines push their cost logs to one place so reports are unified.

## Setup

```bash
cd server
npm install
cp .env.example .env
# Edit .env — generate one API key per machine:
#   openssl rand -hex 32
```

`.env`:
```
CLAUDE_COST_API_KEYS=key1,key2,key3
PORT=5070
```

Start:
```bash
node server.js
# or with PM2:
pm2 start ecosystem.config.js
```

## Putting it behind nginx

```nginx
location /dev/cost/ {
    proxy_pass http://127.0.0.1:5070/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    client_max_body_size 10M;
}
```

## API

All endpoints (except `/health`) require `X-API-Key` header.

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/health`  | Liveness check, no auth |
| POST   | `/sync`    | Body `{ "entries": [...] }` — batch upload, deduped by `msg_id` |
| GET    | `/report`  | Filtered raw log: `?from=&to=&project=&model=&client_id=&limit=` |
| GET    | `/summary` | Aggregates: totals + `by_day`, `by_project`, `by_model`, `by_client` |

Each `client_id` is the first 8 chars of the API key, so per-machine breakdowns work without exposing keys.

## On the client side

In `~/.claude/cost_sync.env`:
```
CLAUDE_COST_API_URL=https://your.server/dev/cost
CLAUDE_COST_API_KEY=that-machine's-key
```

The hook auto-pushes new entries after each Claude response. To backfill existing local history:
```bash
python3 ~/.claude/hooks/backfill_to_server.py
```
