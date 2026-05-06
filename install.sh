#!/bin/bash
# Claude Cost Tracker — installer for client (hook + VSCode extension).
# To configure remote sync: edit ~/.claude/cost_sync.env after install.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_DEST="$HOME/.claude/hooks/cost_tracker.py"
EXT_DEST="$HOME/.vscode/extensions/claude-cost-tracker-0.1.0"
SETTINGS="$HOME/.claude/settings.json"
REGISTRY="$HOME/.vscode/extensions/extensions.json"
SYNC_ENV="$HOME/.claude/cost_sync.env"

echo "==> Installing Claude Cost Tracker"

# 1. Hook
mkdir -p "$HOME/.claude/hooks"
cp "$SCRIPT_DIR/hooks/cost_tracker.py"        "$HOOK_DEST"
cp "$SCRIPT_DIR/hooks/backfill_to_server.py"  "$HOME/.claude/hooks/backfill_to_server.py"
chmod +x "$HOOK_DEST" "$HOME/.claude/hooks/backfill_to_server.py"
echo "    Hook installed"

# 2. VSCode extension
mkdir -p "$EXT_DEST"
cp "$SCRIPT_DIR/vscode-extension/package.json" "$EXT_DEST/"
cp "$SCRIPT_DIR/vscode-extension/extension.js" "$EXT_DEST/"
echo "    Extension installed"

# 3. Register extension in VSCode
if [ -f "$REGISTRY" ] && ! grep -q "claude-cost-tracker" "$REGISTRY"; then
  python3 - "$REGISTRY" "$EXT_DEST" << 'PYEOF'
import json, sys, time
registry, ext = sys.argv[1], sys.argv[2]
data = json.load(open(registry))
data.append({
    "identifier": {"id": "local.claude-cost-tracker"},
    "version": "0.1.0",
    "location": {"$mid": 1, "fsPath": ext, "external": f"file://{ext}", "path": ext, "scheme": "file"},
    "relativeLocation": "claude-cost-tracker-0.1.0",
    "metadata": {"isApplicationScoped": False, "isMachineScoped": False, "isBuiltin": False,
                 "installedTimestamp": int(time.time()*1000), "pinned": False, "source": "vsix",
                 "targetPlatform": "undefined", "updated": False, "private": False,
                 "isPreReleaseVersion": False, "hasPreReleaseVersion": False, "preRelease": False}
})
json.dump(data, open(registry, "w"))
PYEOF
  echo "    Extension registered"
fi

# 4. Claude Code Stop hook
[ -f "$SETTINGS" ] || echo '{"effortLevel": "high"}' > "$SETTINGS"
python3 - "$SETTINGS" "$HOOK_DEST" << 'PYEOF'
import json, sys
settings_path, hook = sys.argv[1], sys.argv[2]
cmd = f"python3 {hook}"
s = json.load(open(settings_path))
hooks = s.setdefault("hooks", {}).setdefault("Stop", [])
already = any(h.get("command") == cmd for entry in hooks for h in entry.get("hooks", []))
if not already:
    hooks.append({"matcher": "", "hooks": [{"type": "command", "command": cmd}]})
    json.dump(s, open(settings_path, "w"), indent=2)
    print("    Stop hook registered")
else:
    print("    Stop hook already registered")
PYEOF

# 5. Init tracker
TRACKER="$HOME/.claude/cost_tracker.json"
[ -f "$TRACKER" ] || echo '{"total_cost":0,"total_requests":0,"by_day":{},"by_project":{},"by_model":{},"sessions":{},"last_updated":"waiting..."}' > "$TRACKER"

# 6. Sync env stub
if [ ! -f "$SYNC_ENV" ]; then
  cat > "$SYNC_ENV" << 'EOF'
# Claude Cost Tracker — sync config (local, never commit).
# Fill in to enable cross-machine sync via your own server:
# CLAUDE_COST_API_URL=https://your.server/path
# CLAUDE_COST_API_KEY=your-secret-key
EOF
  chmod 600 "$SYNC_ENV"
  echo "    Sync stub created at $SYNC_ENV (fill in to enable remote sync)"
fi

echo ""
echo "Done! Restart VSCode to see the cost tracker in the status bar."
echo "For multi-machine sync: see server/README.md, then edit $SYNC_ENV"
