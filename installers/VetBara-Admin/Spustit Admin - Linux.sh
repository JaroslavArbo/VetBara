#!/bin/bash
URL="https://vet-bara.vercel.app/admin.html"
for B in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge; do
  if command -v "$B" >/dev/null 2>&1; then exec "$B" --app="$URL"; fi
done
xdg-open "$URL" >/dev/null 2>&1 &
