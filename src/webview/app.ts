import { createBridge } from "./bridge";
import {
  applyConfiguredBasemapFallback,
  getPmtilesConfig,
  getStyleConfig,
  hasObjectKeys,
  hydrateKeplerPayloadWithSchema,
  normalizeKeplerPayload,
  resolvePmtilesDataset,
  toDataset,
} from "./dataFlow";
import { renderKeplerApp } from "./keplerApp";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  setState(state: unknown): void;
  getState(): unknown;
};

declare const React: any;
declare const ReactDOM: any;
declare const Redux: any;
declare const ReactRedux: any;
declare const styled: any;
declare const KeplerGl: any;

const vscode = acquireVsCodeApi();
const initialWebviewState =
  typeof (window as any).__GEO_DATA_VIEWER_STATE__ === "object"
    ? (window as any).__GEO_DATA_VIEWER_STATE__
    : {};

const runtimeState = {
  currentSourceUri:
    typeof initialWebviewState.uri === "string" ? initialWebviewState.uri : "",
  mapboxToken:
    typeof initialWebviewState.mapboxToken === "string"
      ? initialWebviewState.mapboxToken
      : "",
  mapStyle:
    typeof initialWebviewState.mapStyle === "string"
      ? initialWebviewState.mapStyle
      : "positron",
};

const bridge = createBridge(vscode, runtimeState);

function validateRuntime() {
  const missing = [];
  if (typeof React === "undefined") missing.push("React");
  if (typeof ReactDOM === "undefined") missing.push("ReactDOM");
  if (typeof Redux === "undefined") missing.push("Redux");
  if (typeof ReactRedux === "undefined") missing.push("ReactRedux");
  if (typeof styled === "undefined") missing.push("styled-components");
  if (typeof KeplerGl === "undefined") missing.push("KeplerGl");
  if (missing.length > 0) {
    throw new Error(`Webview runtime missing globals: ${missing.join(", ")}`);
  }
}

function createReducers() {
  return Redux.combineReducers({
    keplerGl: KeplerGl.keplerGlReducer,
  });
}

function createKeplerStore() {
  const middlewares = KeplerGl.enhanceReduxMiddleware([]);
  const enhancer = Redux.applyMiddleware(...middlewares);
  return Redux.createStore(createReducers(), {}, Redux.compose(enhancer));
}

const store = createKeplerStore();

function loadData(kind: string, data: any, meta: any, sourceUri: string, mapStyle: string, mapboxToken: string) {
  if (typeof sourceUri === "string" && sourceUri.length > 0) {
    runtimeState.currentSourceUri = sourceUri;
  }
  if (typeof mapStyle === "string" && mapStyle.length > 0) {
    runtimeState.mapStyle = mapStyle;
  }
  if (typeof mapboxToken === "string") {
    runtimeState.mapboxToken = mapboxToken;
  }
  bridge.persistWebviewState();

  if (kind === "kepler" && meta?.pmtiles?.tilejsonUrl) {
    fetch(meta.pmtiles.tilejsonUrl)
      .then((response) => {
        bridge.postLog(`pmtiles tilejson status: ${response.status}`);
        return response.json();
      })
      .then((tilejson) => {
        const tiles = Array.isArray(tilejson.tiles) ? tilejson.tiles : [];
        if (tiles.length > 0) {
          bridge.postLog(`pmtiles tiles template: ${tiles[0]}`);
        }
      })
      .catch((error) => {
        bridge.postError(error);
      });
  }

  const pmtilesDataset = kind === "kepler" ? resolvePmtilesDataset(data, meta) : null;
  if (pmtilesDataset) {
    store.dispatch(
      KeplerGl.addDataToMap({
        datasets: pmtilesDataset,
        config: getPmtilesConfig(data?.config, runtimeState.mapStyle),
        options: {
          autoCreateLayers: true,
          centerMap: true,
        },
      }),
    );
    bridge.postLog(
      `pmtiles dataset loaded as vector tile: ${pmtilesDataset.info?.label || "unknown"}`,
    );
  } else if (kind === "kepler") {
    const normalized = normalizeKeplerPayload(data);
    const hydrated = hydrateKeplerPayloadWithSchema(
      KeplerGl,
      normalized.datasets,
      normalized.config,
    );
    const fallbackResult = applyConfiguredBasemapFallback(
      hydrated.config,
      runtimeState.mapStyle,
    );
    if (fallbackResult.didFallback) {
      bridge.postLog(
        `unsupported styleType '${fallbackResult.originalStyleType}' fell back to '${fallbackResult.resolvedStyleType}'`,
      );
    }
    const resolvedConfig = fallbackResult.configWrapper || hydrated.config;
    store.dispatch(
      KeplerGl.addDataToMap({
        datasets: hydrated.datasets || [],
        config: hasObjectKeys(resolvedConfig)
          ? resolvedConfig
          : getStyleConfig(runtimeState.mapStyle),
        options: { centerMap: true },
      }),
    );
  } else {
    const dataset = toDataset(KeplerGl, kind, data);
    store.dispatch(
      KeplerGl.addDataToMap({
        datasets: dataset,
        config: getStyleConfig(runtimeState.mapStyle),
        options: { centerMap: true },
      }),
    );
  }

  bridge.postLog(
    `dataset loaded: ${kind}, features: ${meta?.featureCount ?? "unknown"}`,
  );
}

function bootstrap() {
  validateRuntime();

  const container = document.getElementById("map");
  if (!container) {
    throw new Error("Map container not found");
  }

  renderKeplerApp(container, store, KeplerGl.KeplerGl, runtimeState.mapboxToken);
  bridge.wireToolbar();
  bridge.persistWebviewState();
  vscode.postMessage({ command: "ready" });
}

window.addEventListener("message", (event) => {
  try {
    const message = event.data;
    if (message.command === "loadData") {
      loadData(
        message.kind,
        message.data,
        message.meta || {},
        message.sourceUri,
        message.mapStyle,
        message.mapboxToken,
      );
    }
    if (message.command === "error") {
      bridge.postError(message.error || "Unknown webview error");
    }
  } catch (error) {
    bridge.postError(error);
  }
});

try {
  bootstrap();
} catch (error) {
  bridge.postError(error);
  const map = document.getElementById("map");
  if (map) {
    map.innerHTML = `<div class="error">${error instanceof Error ? error.message : String(error)}</div>`;
  }
}
