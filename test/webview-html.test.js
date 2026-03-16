const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const panelSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'webview', 'mapPreviewPanel.ts'),
  'utf8',
);

test('webview html loads built dist vendor assets instead of legacy media/vendor scripts', () => {
  assert.match(panelSource, /media",\s*"dist",\s*"webview\.js"/);
  assert.match(panelSource, /media",\s*"dist",\s*"vendor",\s*"react\.production\.min\.js"/);
  assert.match(panelSource, /media",\s*"dist",\s*"vendor",\s*"react-dom\.production\.min\.js"/);
  assert.match(panelSource, /media",\s*"dist",\s*"vendor",\s*"redux(?:\.min)?\.js"/);
  assert.match(panelSource, /media",\s*"dist",\s*"vendor",\s*"react-redux\.min\.js"/);
  assert.match(panelSource, /media",\s*"dist",\s*"vendor",\s*"styled-components\.min\.js"/);
  assert.match(panelSource, /media",\s*"dist",\s*"vendor",\s*"keplergl\.min\.js"/);
  assert.doesNotMatch(panelSource, /media",\s*"vendor",\s*"react\.production\.min\.js"/);
  assert.doesNotMatch(panelSource, /media",\s*"vendor",\s*"react-dom\.production\.min\.js"/);
  assert.doesNotMatch(panelSource, /media",\s*"vendor",\s*"redux(?:\.min)?\.js"/);
  assert.doesNotMatch(panelSource, /media",\s*"vendor",\s*"react-redux\.min\.js"/);
  assert.doesNotMatch(panelSource, /media",\s*"vendor",\s*"styled-components\.min\.js"/);
  assert.doesNotMatch(panelSource, /media",\s*"vendor",\s*"keplergl\.min\.js"/);
});
