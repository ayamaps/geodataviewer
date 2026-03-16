# Webview Bundling Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hand-managed webview vendor scripts with an esbuild-generated webview bundle without changing extension-host behavior.

**Architecture:** Keep the extension host and parser pipeline intact, move webview runtime logic into modular source files, and emit a single browser bundle consumed by `MapPreviewPanel`. Packaging should ship only the new built asset and required CSS.

**Tech Stack:** TypeScript, esbuild, VS Code webviews, React, Redux, kepler.gl

---

## Chunk 1: Lock the desired behavior with tests

### Task 1: Add failing webview bundle output test

**Files:**
- Create: `test/webview-bundle.test.js`
- Modify: `package.json`

- [ ] Step 1: Write a test that runs `npm run bundle:webview` and expects `media/dist/webview.js` to exist.
- [ ] Step 2: Run `node --test test/webview-bundle.test.js` and verify it fails because the script/output does not exist yet.
- [ ] Step 3: Add the minimal npm script placeholder needed to exercise the test.
- [ ] Step 4: Re-run the targeted test and confirm the failure reason is now missing implementation, not missing script wiring.

### Task 2: Add failing HTML asset reference test

**Files:**
- Create: `test/webview-html.test.js`
- Modify: `src/webview/mapPreviewPanel.ts` or test helpers as needed

- [ ] Step 1: Write a test that inspects the generated webview HTML and asserts it references `media/dist/webview.js` and does not reference legacy vendor JS filenames.
- [ ] Step 2: Run the targeted test and verify it fails against the current HTML output.

## Chunk 2: Build the modular webview source and bundle script

### Task 3: Introduce modular webview source

**Files:**
- Create: `src/webview/app.ts`
- Create: `src/webview/bridge.ts`
- Create: `src/webview/dataFlow.ts`
- Create: `src/webview/keplerApp.ts`
- Optionally modify: `media/styleSupport.js` or inline equivalent logic into source

- [ ] Step 1: Move pure kepler payload normalization and PMTiles handling into `dataFlow.ts`.
- [ ] Step 2: Move VS Code state persistence and message posting helpers into `bridge.ts`.
- [ ] Step 3: Move React mounting and resize handling into `keplerApp.ts`.
- [ ] Step 4: Compose the modules in `app.ts` to reproduce current webview behavior.

### Task 4: Add webview bundling

**Files:**
- Create: `scripts/build-webview.mjs`
- Modify: `package.json`

- [ ] Step 1: Add `bundle:webview` and `build` scripts.
- [ ] Step 2: Configure esbuild to bundle `src/webview/app.ts` for the browser into `media/dist/webview.js`.
- [ ] Step 3: Run `npm run bundle:webview` and confirm the bundle is emitted.
- [ ] Step 4: Re-run `test/webview-bundle.test.js` and confirm it passes.

## Chunk 3: Switch webview HTML and packaging to the new asset

### Task 5: Update panel HTML to consume the bundle

**Files:**
- Modify: `src/webview/mapPreviewPanel.ts`

- [ ] Step 1: Remove legacy vendor JS script tags from the generated HTML.
- [ ] Step 2: Add the bundled webview asset reference.
- [ ] Step 3: Keep required CSS references and serialized state bootstrap intact.
- [ ] Step 4: Run `test/webview-html.test.js` and confirm it passes.

### Task 6: Update VSIX packaging

**Files:**
- Modify: `scripts/package-vsix.sh`
- Modify: `.vscodeignore`

- [ ] Step 1: Ensure packaging runs `bundle:webview`.
- [ ] Step 2: Exclude the old vendor JS assets from the `.vsix` stage.
- [ ] Step 3: Preserve CSS files still used by the webview.

## Chunk 4: Verify end-to-end behavior

### Task 7: Full regression and package verification

**Files:**
- No new files expected

- [ ] Step 1: Run `pnpm test`.
- [ ] Step 2: Run `pnpm run package:vsix`.
- [ ] Step 3: Inspect the VSIX contents and confirm it contains the new webview bundle but not the old vendor JS files.
- [ ] Step 4: Record resulting package size and note the remaining dominant assets.
