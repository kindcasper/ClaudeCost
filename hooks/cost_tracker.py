#!/usr/bin/env python3
"""
Claude Code Stop hook — tracks API cost per session.

Reads usage data from the Claude Code transcript JSONL, calculates cost
per model, and writes cumulative stats to ~/.claude/cost_tracker.json.
The VSCode extension reads that file and shows the total in the status bar.
"""
import json, sys, os
from datetime import datetime, timezone

COST_FILE = os.path.expanduser("~/.claude/cost_tracker.json")

# Pricing per million tokens: (input, cache_5m_write, cache_1h_write, cache_hit, output)
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
DEFAULT_PRICING = (3, 3.75, 6, 0.30, 15)  # Sonnet 4.6 fallback
M = 1_000_000


def get_pricing(model: str) -> tuple:
    m = (model or "").lower()
    for key, prices in PRICING.items():
        if key in m:
            return prices
    return DEFAULT_PRICING


def compute_cost(usage: dict, model: str) -> float:
    p_in, p_c5, p_c1h, p_hit, p_out = get_pricing(model)
    input_tok  = usage.get("input_tokens", 0)
    output_tok = usage.get("output_tokens", 0)
    cache_hit  = usage.get("cache_read_input_tokens", 0)
    cc         = usage.get("cache_creation", {})
    cache_5m   = cc.get("ephemeral_5m_input_tokens", 0) or usage.get("cache_creation_input_tokens", 0)
    cache_1h   = cc.get("ephemeral_1h_input_tokens", 0)
    return (
        input_tok  * p_in  / M +
        output_tok * p_out / M +
        cache_hit  * p_hit / M +
        cache_5m   * p_c5  / M +
        cache_1h   * p_c1h / M
    )


def main():
    try:
        hook_data = json.loads(sys.stdin.read())
    except Exception:
        return

    transcript_path = hook_data.get("transcript_path")
    session_id = hook_data.get("session_id", "unknown")
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
    tracker.setdefault("sessions", {})

    session  = tracker["sessions"].setdefault(session_id, {"seen_ids": []})
    seen_ids = set(session.get("seen_ids", []))
    new_cost = 0.0
    new_ids  = []

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

            new_cost += compute_cost(usage, msg.get("model", ""))
            seen_ids.add(msg_id)
            new_ids.append(msg_id)

    if new_cost == 0:
        return

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    tracker["by_day"][today]  = tracker["by_day"].get(today, 0) + new_cost
    tracker["total_cost"]    += new_cost
    tracker["total_requests"] += len(new_ids)
    tracker["last_updated"]   = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    session["seen_ids"]       = list(seen_ids)

    with open(COST_FILE, "w") as f:
        json.dump(tracker, f, indent=2)


if __name__ == "__main__":
    main()
