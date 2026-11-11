#!/bin/sh
# Build a throwaway git checkout of the demo fixture.
# Usage: ./setup.sh [dest]
set -e
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
dest=${1:-/tmp/shipsane-demo}
rm -rf "$dest"
mkdir -p "$dest"
cp -R "$here/before/." "$dest/"
cd "$dest"
git init -b main >/dev/null
git -c user.name=shipsane-demo -c user.email=shipsane-demo@example.com -c commit.gpgsign=false add -A
git -c user.name=shipsane-demo -c user.email=shipsane-demo@example.com -c commit.gpgsign=false commit -m "baseline" >/dev/null
cp -R "$here/after/." "$dest/"
cp "$here/transcript.txt" "$dest/transcript.txt"
echo "$dest"
