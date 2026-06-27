#!/bin/bash
set -e
BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$BASE_DIR"
ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ]; then PLATFORM="macos-arm64"; else PLATFORM="macos-x64"; fi
find_node() {
  for CANDIDATE in "$BASE_DIR/runtime/$PLATFORM/bin/node" "$BASE_DIR/runtime/$PLATFORM/node"; do
    if [ -x "$CANDIDATE" ]; then echo "$CANDIDATE"; return 0; fi
  done
  if command -v node >/dev/null 2>&1; then command -v node; return 0; fi
  return 1
}
NODE_BIN="$(find_node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "Node runtime is missing. Installing it now..."
  "$BASE_DIR/Install runtime - macOS.command" --no-prompt
  NODE_BIN="$(find_node || true)"
fi
if [ -z "$NODE_BIN" ]; then
  echo "Node runtime is still missing. Check internet access or install Node.js manually."
  read -r -p "Press Enter to close."
  exit 1
fi
"$NODE_BIN" "$BASE_DIR/app/server.cjs" --mode=admin
