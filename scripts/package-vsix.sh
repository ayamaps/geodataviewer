#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE_DIR="$ROOT_DIR/.vsix-stage"
DIST_DIR="$ROOT_DIR/dist"
PACKAGE_NAME="$(node -p "require('$ROOT_DIR/package.json').name")"
PACKAGE_VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
OUTPUT_FILE="$DIST_DIR/${PACKAGE_NAME}-${PACKAGE_VERSION}.vsix"

cleanup() {
  rm -rf "$STAGE_DIR"
}

prune_stage() {
  find "$STAGE_DIR" -name '.DS_Store' -delete

  if [ -d "$STAGE_DIR/out" ]; then
    find "$STAGE_DIR/out" -type f -name '*.js.map' -delete
  fi

  rm -f "$STAGE_DIR/package-lock.json"

  if [ -d "$STAGE_DIR/media/vendor" ]; then
    rm -f \
      "$STAGE_DIR/media/vendor/keplergl.min.js" \
      "$STAGE_DIR/media/vendor/react.production.min.js" \
      "$STAGE_DIR/media/vendor/react-dom.production.min.js" \
      "$STAGE_DIR/media/vendor/redux.js" \
      "$STAGE_DIR/media/vendor/react-redux.min.js" \
      "$STAGE_DIR/media/vendor/styled-components.min.js" \
      "$STAGE_DIR/media/vendor/redux.min.js"
  fi
}

trap cleanup EXIT

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR" "$DIST_DIR"

npm run compile --prefix "$ROOT_DIR"
npm run bundle:extension --prefix "$ROOT_DIR"
npm run bundle:webview --prefix "$ROOT_DIR"

cp "$ROOT_DIR/package.json" "$STAGE_DIR/package.json"

node -e '
  const fs = require("fs");
  const manifestPath = process.argv[1];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.scripts) {
    delete manifest.scripts["vscode:prepublish"];
  }
  delete manifest.dependencies;
  delete manifest.devDependencies;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
' "$STAGE_DIR/package.json"

for path in README.md .vscodeignore media resources; do
  if [ -e "$ROOT_DIR/$path" ]; then
    cp -R "$ROOT_DIR/$path" "$STAGE_DIR/$path"
  fi
done

mkdir -p "$STAGE_DIR/out/extension"
cp "$ROOT_DIR/dist/bundle/extension.js" "$STAGE_DIR/out/extension/extension.js"

(
  cd "$STAGE_DIR"
  prune_stage
  "$ROOT_DIR/node_modules/.bin/vsce" package \
    --no-yarn \
    --allow-missing-repository \
    --skip-license \
    --out "$OUTPUT_FILE"
)

printf 'Created %s\n' "$OUTPUT_FILE"
