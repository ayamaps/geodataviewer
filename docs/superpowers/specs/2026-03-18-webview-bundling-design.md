# Webview Bundling Design

## Goal
Replace manually managed webview vendor scripts with an npm + esbuild build pipeline while keeping the existing VS Code extension host, message bridge contract, and map rendering behavior intact.

## Scope
- Keep `images/` in the repo but continue excluding it from `.vsix` packaging.
- Replace the current HTML script injection of `react`, `react-dom`, `redux`, `react-redux`, `styled-components`, and `keplergl.min.js` with a single built webview bundle.
- Preserve current toolbar behavior, persisted webview state, message protocol, and map rendering flow.
- Do not refactor extension-host parsing or panel restoration behavior beyond what is required to load the new webview asset.

## Architecture
- Introduce a modular webview source tree under `src/webview/`.
- Move the current `media/main.js` behavior into module-based source files:
  - `app.ts` for bootstrapping
  - `keplerApp.tsx` for React rendering and size handling
  - `bridge.ts` for VS Code message flow and persistence
  - `dataFlow.ts` for pure kepler payload normalization and basemap fallback helpers
- Build the webview with `esbuild` into `media/dist/webview.js`.
- Update `MapPreviewPanel.getWebviewContent()` to load the built asset instead of the old vendor JS chain.
- Keep CSS assets local unless they can be folded safely into the bundle later.

## Build Strategy
- Reuse `esbuild`, already added for extension-host bundling.
- Add a dedicated `bundle:webview` script.
- Add a repo-level `build` script that runs TypeScript compilation plus extension/webview bundling.
- Update `.vsix` staging to include `media/dist/webview.js` and exclude the old vendor JS files.

## Testing Strategy
- Add a failing test first for `bundle:webview` that requires `media/dist/webview.js` to be emitted.
- Add a test that the generated webview HTML no longer references legacy vendor JS paths and instead references the built bundle.
- Preserve all existing parsing and packaging tests.
- Verify `pnpm test` and `pnpm run package:vsix`.

## Risks
- `kepler.gl` may require bundler compatibility adjustments for browser builds.
- The resulting `.vsix` may not shrink dramatically if `kepler.gl` remains the dominant front-end payload, but the asset pipeline will become maintainable and testable.
