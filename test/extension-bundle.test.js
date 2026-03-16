const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const bundlePath = path.join(repoRoot, 'dist', 'bundle', 'extension.js');

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

test('bundle:extension emits a self-contained extension host bundle', () => {
  fs.rmSync(bundlePath, { force: true });

  execFileSync(npmCommand(), ['run', 'bundle:extension'], {
    cwd: repoRoot,
    stdio: 'pipe',
    env: process.env,
  });

  assert.equal(fs.existsSync(bundlePath), true);

  const bundle = fs.readFileSync(bundlePath, 'utf8');
  assert.match(bundle, /require\(["']vscode["']\)/);
  assert.doesNotMatch(bundle, /require\(["']@loaders\.gl\//);
  assert.doesNotMatch(bundle, /require\(["']pmtiles["']\)/);
  assert.doesNotMatch(bundle, /require\(["']topojson-client["']\)/);
});
