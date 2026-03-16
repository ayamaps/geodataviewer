const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const {
  MAP_GALLERY_RAW_BASE_URL,
  resolveMapGalleryTarget,
} = require("../out/extension/vscodeFeatures.js");

test("resolveMapGalleryTarget builds GitHub raw URLs from relative paths", () => {
  assert.equal(
    MAP_GALLERY_RAW_BASE_URL,
    "https://raw.githubusercontent.com/ayamaps/geodataviewer/refs/heads/main/",
  );
  assert.equal(
    resolveMapGalleryTarget("data/kgl/chicago-bike-routes.map.json"),
    "https://raw.githubusercontent.com/ayamaps/geodataviewer/refs/heads/main/data/kgl/chicago-bike-routes.map.json",
  );
});

test(".vscodeignore excludes bundled sample data", () => {
  const ignoreFile = fs.readFileSync(
    path.join(__dirname, "..", ".vscodeignore"),
    "utf8",
  );
  assert.match(ignoreFile, /^data\/\*\*$/m);
});
