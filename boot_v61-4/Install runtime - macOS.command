#!/bin/bash
set -e
BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
NO_PROMPT="${1:-}"
NODE_VERSION="20.18.1"
ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ]; then PLATFORM="macos-arm64"; NODE_ARCH="darwin-arm64"; else PLATFORM="macos-x64"; NODE_ARCH="darwin-x64"; fi
URL_BASE="https://nodejs.org/dist/v$NODE_VERSION"
FILE="node-v$NODE_VERSION-$NODE_ARCH.tar.gz"
WORK="$BASE_DIR/runtime/.download-$PLATFORM"
TARGET="$BASE_DIR/runtime/$PLATFORM"
mkdir -p "$WORK" "$TARGET"
echo "Installing Node.js $NODE_VERSION for $PLATFORM"
echo "This requires internet access for the first run only."
cd "$WORK"
curl -L -o SHASUMS256.txt "$URL_BASE/SHASUMS256.txt"
curl -L -o "$FILE" "$URL_BASE/$FILE"
EXPECTED="$(grep " $FILE$" SHASUMS256.txt | awk '{print $1}')"
ACTUAL="$(shasum -a 256 "$FILE" | awk '{print $1}')"
if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "Checksum verification failed. Runtime was not installed."
  exit 1
fi
rm -rf "$TARGET"
mkdir -p "$TARGET"
tar -xzf "$FILE" --strip-components=1 -C "$TARGET"
chmod +x "$TARGET/bin/node"
echo "Runtime installed: $TARGET/bin/node"
if [ "$NO_PROMPT" != "--no-prompt" ]; then
  read -r -p "Press Enter to close."
fi
