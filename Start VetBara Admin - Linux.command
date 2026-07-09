#!/bin/bash
set -e
BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$BASE_DIR"
NODE_BIN=""
for CANDIDATE in "$BASE_DIR/runtime/linux-x64/bin/node" "$BASE_DIR/runtime/linux-x64/node"; do
  if [ -x "$CANDIDATE" ]; then NODE_BIN="$CANDIDATE"; break; fi
done
if [ -z "$NODE_BIN" ]; then
  if command -v node >/dev/null 2>&1; then NODE_BIN="$(command -v node)"; fi
fi
if [ -z "$NODE_BIN" ]; then
  echo "Node runtime is missing. Install Node.js or add runtime/linux-x64/node."
  read -r -p "Press Enter to close."
  exit 1
fi

"$NODE_BIN" "$BASE_DIR/app/server.cjs" --mode=admin
