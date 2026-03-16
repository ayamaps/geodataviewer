const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const bundlePath = path.join(repoRoot, 'media', 'dist', 'webview.js');

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

test('bundle:webview emits the built webview asset', () => {
  fs.rmSync(bundlePath, { force: true });

  execFileSync(npmCommand(), ['run', 'bundle:webview'], {
    cwd: repoRoot,
    stdio: 'pipe',
    env: process.env,
  });

  assert.equal(fs.existsSync(bundlePath), true);
  const bundle = fs.readFileSync(bundlePath, 'utf8');
  assert.match(bundle, /acquireVsCodeApi/);
});
