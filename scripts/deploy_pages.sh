#!/usr/bin/env bash
# Builds the merged app for GitHub Pages and pushes only the built files to the gh-pages branch of
# github.com/xignoe/trashlab-demo. Source, prompts, and context stay local. Live at https://xignoe.github.io/trashlab-demo/
set -euo pipefail

REPO="xignoe/trashlab-demo"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/.pages-build"

cd "$ROOT"
BASE_PATH="/trashlab-demo/" npm run build

rm -rf "$OUT"
cp -R dist "$OUT"
# Deep links (/trashlab-demo/office/account/...) have no file on Pages; its 404.html is the SPA, so the router takes over.
cp "$OUT/index.html" "$OUT/404.html"
touch "$OUT/.nojekyll"

cd "$OUT"
git init -q -b gh-pages
git add -A
git -c user.name="xignoe" -c user.email="xignoe@users.noreply.github.com" commit -q -m "Deploy $(date -u +%Y-%m-%dT%H:%MZ)"
# Authenticate through the gh CLI login without touching global git config.
git -c credential.helper= -c credential.helper='!gh auth git-credential' push -q -f "https://github.com/$REPO.git" gh-pages
cd "$ROOT" && rm -rf "$OUT"
echo "Pushed. https://xignoe.github.io/trashlab-demo/"
