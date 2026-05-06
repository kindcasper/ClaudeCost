#!/usr/bin/env python3
"""
One-shot backfill: read local cost_log.jsonl and push everything to the sync server.
Server uses INSERT OR IGNORE on msg_id, so duplicates are safe.
"""
import json, os, sys, urllib.request

LOG_FILE = os.path.expanduser("~/.claude/cost_log.jsonl")
SYNC_ENV = os.path.expanduser("~/.claude/cost_sync.env")
BATCH    = 200


def load_cfg():
    cfg = {}
    if not os.path.exists(SYNC_ENV):
        sys.exit("No ~/.claude/cost_sync.env — nothing to do")
    with open(SYNC_ENV) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                cfg[k.strip()] = v.strip().strip('"').strip("'")
    if not cfg.get("CLAUDE_COST_API_URL") or not cfg.get("CLAUDE_COST_API_KEY"):
        sys.exit("Missing CLAUDE_COST_API_URL or CLAUDE_COST_API_KEY")
    return cfg


def push(batch, cfg):
    url = cfg["CLAUDE_COST_API_URL"].rstrip("/") + "/sync"
    req = urllib.request.Request(
        url,
        data=json.dumps({"entries": batch}).encode(),
        headers={"Content-Type": "application/json", "X-API-Key": cfg["CLAUDE_COST_API_KEY"]},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def main():
    if not os.path.exists(LOG_FILE):
        sys.exit("No local log to backfill")

    cfg = load_cfg()
    print(f"Pushing to: {cfg['CLAUDE_COST_API_URL']}")

    batch, total_inserted, total_seen = [], 0, 0
    with open(LOG_FILE) as f:
        for line in f:
            line = line.strip()
            if not line: continue
            try:
                batch.append(json.loads(line))
            except Exception:
                continue
            if len(batch) >= BATCH:
                r = push(batch, cfg)
                total_inserted += r.get("inserted", 0)
                total_seen     += r.get("total_received", 0)
                print(f"  pushed {len(batch)} → inserted {r.get('inserted',0)} (total inserted: {total_inserted})")
                batch = []

    if batch:
        r = push(batch, cfg)
        total_inserted += r.get("inserted", 0)
        total_seen     += r.get("total_received", 0)
        print(f"  pushed {len(batch)} → inserted {r.get('inserted',0)}")

    print(f"\nDone. Sent {total_seen} entries, server inserted {total_inserted} new ones.")


if __name__ == "__main__":
    main()
