#!/usr/bin/env python3
"""
Claude Code Stop hook — tracks API cost per session.

Reads usage from the Claude Code transcript JSONL, calculates cost per model,
writes locally, and (if configured) pushes new entries to a remote sync server.

Local files:
  ~/.claude/cost_tracker.json — summary
  ~/.claude/cost_log.jsonl    — detailed log

Optional remote sync (config in ~/.claude/cost_sync.env):
  CLAUDE_COST_API_URL=https://example.com/dev/cost
  CLAUDE_COST_API_KEY=<api-key>
"""
import json, sys, os, urllib.request, urllib.error
from datetime import datetime, timezone

COST_FILE  = os.path.expanduser("~/.claude/cost_tracker.json")
LOG_FILE   = os.path.expanduser("~/.claude/cost_log.jsonl")
SYNC_ENV   = os.path.expanduser("~/.claude/cost_sync.env")
SYNC_STATE = os.path.expanduser("~/.claude/cost_sync_state.json")

PRICING = {
    "claude-opus-4-7":   (5,    6.25,  10,   0.50, 25),
    "claude-opus-4-6":   (5,    6.25,  10,   0.50, 25),
    "claude-opus-4-5":   (5,    6.25,  10,   0.50, 25),
    "claude-opus-4-1":   (15,   18.75, 30,   1.50, 75),
    "claude-opus-4":     (15,   18.75, 30,   1.50, 75),
    "claude-sonnet-4-6": (3,    3.75,  6,    0.30, 15),
    "claude-sonnet-4-5": (3,    3.75,  6,    0.30, 15),
    "claude-sonnet-4":   (3,    3.75,  6,    0.30, 15),
    "claude-sonnet-3-7": (3,    3.75,  6,    0.30, 15),
    "claude-haiku-4-5":  (1,    1.25,  2,    0.10,  5),
    "claude-haiku-3-5":  (0.8,  1,     1.6,  0.08,  4),
    "claude-opus-3":     (15,   18.75, 30,   1.50, 75),
    "claude-haiku-3":    (0.25, 0.30,  0.50, 0.03,  1.25),
}
DEFAULT_PRICING = (3, 3.75, 6, 0.30, 15)
M = 1_000_000


def get_pricing(model):
    m = (model or "").lower()
    for key, prices in PRICING.items():
        if key in m:
            return prices
    return DEFAULT_PRICING


def compute_cost(usage, model):
    p_in, p_c5, p_c1h, p_hit, p_out = get_pricing(model)
    cc = usage.get("cache_creation", {})
    cache_5m = cc.get("ephemeral_5m_input_tokens", 0) or usage.get("cache_creation_input_tokens", 0)
    cache_1h = cc.get("ephemeral_1h_input_tokens", 0)
    return (
        usage.get("input_tokens", 0)            * p_in  / M +
        usage.get("output_tokens", 0)           * p_out / M +
        usage.get("cache_read_input_tokens", 0) * p_hit / M +
        cache_5m                                * p_c5  / M +
        cache_1h                                * p_c1h / M
    )


def project_name(cwd):
    return os.path.basename(cwd.rstrip("/")) if cwd else "unknown"


def load_sync_config():
    if not os.path.exists(SYNC_ENV):
        return None
    cfg = {}
    with open(SYNC_ENV) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip().strip('"').strip("'")
    if not cfg.get("CLAUDE_COST_API_URL") or not cfg.get("CLAUDE_COST_API_KEY"):
        return None
    return cfg


def push_to_server(entries, cfg):
    url = cfg["CLAUDE_COST_API_URL"].rstrip("/") + "/sync"
    payload = json.dumps({"entries": entries}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-API-Key":    cfg["CLAUDE_COST_API_KEY"],
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
        return None


def main():
    try:
        hook_data = json.loads(sys.stdin.read())
    except Exception:
        return

    transcript_path = hook_data.get("transcript_path")
    session_id      = hook_data.get("session_id", "unknown")
    cwd             = hook_data.get("cwd", "")
    project         = project_name(cwd)
    if not transcript_path or not os.path.exists(transcript_path):
        return

    try:
        with open(COST_FILE) as f:
            tracker = json.load(f)
    except Exception:
        tracker = {}

    tracker.setdefault("total_cost", 0)
    tracker.setdefault("total_requests", 0)
    tracker.setdefault("by_day", {})
    tracker.setdefault("by_project", {})
    tracker.setdefault("by_model", {})
    tracker.setdefault("sessions", {})

    session  = tracker["sessions"].setdefault(session_id, {"seen_ids": [], "project": project})
    seen_ids = set(session.get("seen_ids", []))

    today       = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    log_entries = []

    with open(transcript_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except Exception:
                continue
            msg = entry.get("message", {})
            if msg.get("role") != "assistant":
                continue
            usage = msg.get("usage")
            if not usage:
                continue
            msg_id = msg.get("id")
            if not msg_id or msg_id in seen_ids:
                continue

            model = msg.get("model", "unknown")
            cc    = usage.get("cache_creation", {})
            cost  = compute_cost(usage, model)

            log_entries.append({
                "ts":              datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "date":            today,
                "session_id":      session_id,
                "project":         project,
                "cwd":             cwd,
                "model":           model,
                "msg_id":          msg_id,
                "input_tokens":    usage.get("input_tokens", 0),
                "output_tokens":   usage.get("output_tokens", 0),
                "cache_read":      usage.get("cache_read_input_tokens", 0),
                "cache_write_5m":  cc.get("ephemeral_5m_input_tokens", 0) or usage.get("cache_creation_input_tokens", 0),
                "cache_write_1h":  cc.get("ephemeral_1h_input_tokens", 0),
                "cost_usd":        round(cost, 8),
            })

            seen_ids.add(msg_id)
            tracker["by_day"][today]       = tracker["by_day"].get(today, 0) + cost
            tracker["by_project"][project] = tracker["by_project"].get(project, 0) + cost
            tracker["by_model"][model]     = tracker["by_model"].get(model, 0) + cost
            tracker["total_cost"]         += cost
            tracker["total_requests"]     += 1

    if not log_entries:
        return

    tracker["last_updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    session["seen_ids"]     = list(seen_ids)

    with open(COST_FILE, "w") as f:
        json.dump(tracker, f, indent=2)

    with open(LOG_FILE, "a") as f:
        for e in log_entries:
            f.write(json.dumps(e) + "\n")

    # Remote sync (best-effort, doesn't block hook on failure)
    cfg = load_sync_config()
    if cfg:
        result = push_to_server(log_entries, cfg)
        if result is not None:
            try:
                state = json.load(open(SYNC_STATE)) if os.path.exists(SYNC_STATE) else {}
            except Exception:
                state = {}
            state["last_sync"]      = datetime.now(timezone.utc).isoformat()
            state["last_inserted"]  = result.get("inserted", 0)
            state["last_received"]  = result.get("total_received", 0)
            state["total_synced"]   = state.get("total_synced", 0) + result.get("inserted", 0)
            with open(SYNC_STATE, "w") as f:
                json.dump(state, f, indent=2)


if __name__ == "__main__":
    main()
