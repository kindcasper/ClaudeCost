#!/bin/bash
# Claude Cost Tracker — installer
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_DEST="$HOME/.claude/hooks/cost_tracker.py"
EXT_DEST="$HOME/.vscode/extensions/claude-cost-tracker-0.1.0"
SETTINGS="$HOME/.claude/settings.json"
REGISTRY="$HOME/.vscode/extensions/extensions.json"

echo "==> Installing Claude Cost Tracker"

# 1. Hook script
mkdir -p "$HOME/.claude/hooks"
cp "$SCRIPT_DIR/hooks/cost_tracker.py" "$HOOK_DEST"
chmod +x "$HOOK_DEST"
echo "    Hook installed: $HOOK_DEST"

# 2. VSCode extension
mkdir -p "$EXT_DEST"
cp "$SCRIPT_DIR/vscode-extension/package.json" "$EXT_DEST/"
cp "$SCRIPT_DIR/vscode-extension/extension.js"  "$EXT_DEST/"
echo "    Extension installed: $EXT_DEST"

# 3. Register extension in VSCode registry
if [ -f "$REGISTRY" ]; then
  if ! grep -q "claude-cost-tracker" "$REGISTRY"; then
    python3 - "$REGISTRY" "$EXT_DEST" << 'PYEOF'
import json, sys, time, os

registry_path = sys.argv[1]
ext_path = sys.argv[2]

with open(registry_path) as f:
    data = json.load(f)

data.append({
    "identifier": {"id": "local.claude-cost-tracker"},
    "version": "0.1.0",
    "location": {
        "$mid": 1,
        "fsPath": ext_path,
        "external": f"file://{ext_path}",
        "path": ext_path,
        "scheme": "file"
    },
    "relativeLocation": "claude-cost-tracker-0.1.0",
    "metadata": {
        "isApplicationScoped": False,
        "isMachineScoped": False,
        "isBuiltin": False,
        "installedTimestamp": int(time.time() * 1000),
        "pinned": False,
        "source": "vsix",
        "targetPlatform": "undefined",
        "updated": False,
        "private": False,
        "isPreReleaseVersion": False,
        "hasPreReleaseVersion": False,
        "preRelease": False
    }
})

with open(registry_path, "w") as f:
    json.dump(data, f)
PYEOF
    echo "    Extension registered in VSCode"
  else
    echo "    Extension already registered, skipping"
  fi
fi

# 4. Claude Code hook in settings.json
if [ ! -f "$SETTINGS" ]; then
  echo '{"effortLevel": "high"}' > "$SETTINGS"
fi

python3 - "$SETTINGS" "$HOOK_DEST" << 'PYEOF'
import json, sys

settings_path = sys.argv[1]
hook_cmd = f"python3 {sys.argv[2]}"

with open(settings_path) as f:
    settings = json.load(f)

hooks = settings.setdefault("hooks", {})
stop_hooks = hooks.setdefault("Stop", [])

already = any(
    h.get("command") == hook_cmd
    for entry in stop_hooks
    for h in entry.get("hooks", [])
)

if not already:
    stop_hooks.append({
        "matcher": "",
        "hooks": [{"type": "command", "command": hook_cmd}]
    })
    with open(settings_path, "w") as f:
        json.dump(settings, f, indent=2)
    print("    Hook registered in ~/.claude/settings.json")
else:
    print("    Hook already registered, skipping")
PYEOF

# 5. Init empty tracker if not exists
TRACKER="$HOME/.claude/cost_tracker.json"
if [ ! -f "$TRACKER" ]; then
  echo '{"total_cost":0,"total_requests":0,"by_day":{},"sessions":{},"last_updated":"waiting for first request..."}' > "$TRACKER"
  echo "    Created: $TRACKER"
fi

echo ""
echo "Done! Restart VSCode to see the cost tracker in the status bar (bottom right)."
