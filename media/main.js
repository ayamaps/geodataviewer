(function () {
  const vscode = acquireVsCodeApi();
  const initialWebviewState =
    typeof window.__GEO_DATA_VIEWER_STATE__ === "object"
      ? window.__GEO_DATA_VIEWER_STATE__
      : {};

  const state = {
    store: null,
    isReady: false,
    currentSourceUri:
      typeof initialWebviewState.uri === "string"
        ? initialWebviewState.uri
        : "",
    mapboxToken:
      typeof initialWebviewState.mapboxToken === "string"
        ? initialWebviewState.mapboxToken
        : "",
    mapStyle:
      typeof initialWebviewState.mapStyle === "string"
        ? initialWebviewState.mapStyle
        : "positron",
  };

  function postLog(data) {
    vscode.postMessage({ command: "log", data });
  }

  function postError(error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.postMessage({ command: "error", error: message });
  }

  function persistWebviewState() {
    vscode.setState({
      uri: state.currentSourceUri,
      mapboxToken: state.mapboxToken,
      mapStyle: state.mapStyle,
    });
  }

  function createReducers() {
    return Redux.combineReducers({
      keplerGl: KeplerGl.keplerGlReducer,
    });
  }

  function createStore() {
    const middlewares = KeplerGl.enhanceReduxMiddleware([]);
    const enhancer = Redux.applyMiddleware(...middlewares);
    return Redux.createStore(createReducers(), {}, Redux.compose(enhancer));
  }

  function createApp(store, mapboxToken) {
    function App() {
      const sizeState = React.useState({
        width: window.innerWidth,
        height: window.innerHeight,
      });
      const size = sizeState[0];
      const setSize = sizeState[1];

      React.useEffect(function () {
        function onResize() {
          setSize({
            width: window.innerWidth,
            height: window.innerHeight,
          });
        }
        window.addEventListener("resize", onResize);
        return function () {
          window.removeEventListener("resize", onResize);
        };
      }, []);

      return React.createElement(
        "div",
        {
          style: {
            position: "absolute",
            left: 0,
            width: "100vw",
            height: "100vh",
          },
        },
        React.createElement(KeplerGl.KeplerGl, {
          id: "kepler-map",
          width: size.width,
          height: size.height,
          mapboxApiAccessToken: mapboxToken,
        }),
      );
    }

    return React.createElement(
      ReactRedux.Provider,
      { store },
      React.createElement(App, null),
    );
  }

  function getStyleConfig(mapStyle) {
    return {
      version: "v1",
      config: {
        mapStyle: {
          styleType: mapStyle || "positron",
        },
      },
    };
  }

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function isKeplerInnerConfig(config) {
    if (!isObject(config)) {
      return false;
    }
    return Boolean(config.visState || config.mapState || config.mapStyle);
  }

  function isKeplerConfigWrapper(config) {
    return isObject(config) && isKeplerInnerConfig(config.config);
  }

  function normalizeKeplerConfig(config) {
    if (isKeplerConfigWrapper(config)) {
      return config;
    }
    if (isKeplerInnerConfig(config)) {
      return {
        version: typeof config.version === "string" ? config.version : "v1",
        config,
      };
    }
    return {};
  }

  function normalizeKeplerPayload(data) {
    if (Array.isArray(data)) {
      return {
        datasets: data,
        config: {},
      };
    }
    if (!isObject(data)) {
      return {
        datasets: [],
        config: {},
      };
    }

    const datasets = Array.isArray(data.datasets)
      ? data.datasets
      : isObject(data.datasets)
        ? [data.datasets]
        : [];

    const config = normalizeKeplerConfig(data.config || data);
    return {
      datasets,
      config,
    };
  }

  function applyConfiguredBasemapFallback(config, fallbackMapStyle) {
    const normalized = normalizeKeplerConfig(config);
    if (!isObject(normalized) || Object.keys(normalized).length === 0) {
      return normalized;
    }

    const styleSupport = globalThis.GeoDataViewerStyleSupport;
    if (
      !styleSupport ||
      typeof styleSupport.applyStyleTypeFallback !== "function"
    ) {
      return normalized;
    }

    const result = styleSupport.applyStyleTypeFallback(
      normalized,
      fallbackMapStyle,
    );
    if (result?.didFallback) {
      postLog(
        `unsupported styleType '${result.originalStyleType}' fell back to '${result.resolvedStyleType}'`,
      );
    }

    return result?.configWrapper || normalized;
  }

  function isVectorTileDataset(dataset) {
    return (
      isObject(dataset) &&
      isObject(dataset.info) &&
      dataset.info.type === "vector-tile" &&
      isObject(dataset.metadata) &&
      typeof dataset.metadata.tilesetDataUrl === "string"
    );
  }

  function resolvePmtilesDataset(data, meta) {
    if (!meta?.pmtiles) {
      return null;
    }
    const normalized = normalizeKeplerPayload(data);
    return normalized.datasets.find(isVectorTileDataset) || null;
  }

  function getPmtilesConfig(config, mapStyle) {
    const normalized = applyConfiguredBasemapFallback(config, mapStyle);
    const fallback = getStyleConfig(mapStyle);
    if (!isKeplerConfigWrapper(normalized)) {
      return fallback;
    }

    return {
      version: normalized.version || fallback.version,
      config: {
        ...normalized.config,
        mapStyle: {
          ...(fallback.config?.mapStyle || {}),
          ...(normalized.config?.mapStyle || {}),
          styleType:
            mapStyle ||
            normalized.config?.mapStyle?.styleType ||
            fallback.config?.mapStyle?.styleType ||
            "positron",
        },
      },
    };
  }

  function hydrateKeplerPayloadWithSchema(datasets, config) {
    if (
      !KeplerGl.KeplerGlSchema ||
      typeof KeplerGl.KeplerGlSchema.load !== "function"
    ) {
      return { datasets, config };
    }

    try {
      const loaded = KeplerGl.KeplerGlSchema.load(datasets, config || {});
      return {
        datasets: loaded?.datasets || datasets,
        config: loaded?.config || config,
      };
    } catch (error) {
      postLog(
        `KeplerGlSchema.load fallback used: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { datasets, config };
    }
  }

  function rowsToCsv(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return "";
    }
    const headers = Object.keys(rows[0]);
    const headerLine = headers.join(",");
    const body = rows
      .map((row) => {
        return headers
          .map((h) => {
            const value = row[h] ?? "";
            const text = String(value).replace(/"/g, '""');
            return `"${text}"`;
          })
          .join(",");
      })
      .join("\n");
    return `${headerLine}\n${body}`;
  }

  function toDataset(kind, data, meta) {
    if (kind === "geojson") {
      return {
        info: { id: "dataset-geojson", label: "GeoJSON" },
        data: KeplerGl.processGeojson(data),
      };
    }
    if (kind === "table") {
      const rows = Array.isArray(data?.rows)
        ? data.rows
        : Array.isArray(data)
          ? data
          : [];
      const csv = rowsToCsv(rows);
      return {
        info: { id: "dataset-table", label: "Table" },
        data: KeplerGl.processCsvData(csv),
      };
    }
    if (kind === "kepler") {
      const datasets = Array.isArray(data?.datasets) ? data.datasets : [];
      return {
        info: { id: "dataset-kepler", label: "Kepler" },
        data: {
          datasets,
          config: data?.config || {},
        },
      };
    }
    throw new Error(`Unsupported dataset kind: ${kind}`);
  }

  function loadData(kind, data, meta, sourceUri, mapStyle, mapboxToken) {
    if (!state.store) {
      throw new Error("Kepler store is not initialized");
    }

    if (typeof sourceUri === "string" && sourceUri.length > 0) {
      state.currentSourceUri = sourceUri;
    }
    if (typeof mapStyle === "string" && mapStyle.length > 0) {
      state.mapStyle = mapStyle;
    }
    if (typeof mapboxToken === "string") {
      state.mapboxToken = mapboxToken;
    }
    persistWebviewState();

    if (kind === "kepler" && meta && meta.pmtiles && meta.pmtiles.tilejsonUrl) {
      fetch(meta.pmtiles.tilejsonUrl)
        .then((r) => {
          postLog(`pmtiles tilejson status: ${r.status}`);
          return r.json();
        })
        .then((j) => {
          const tiles = Array.isArray(j.tiles) ? j.tiles : [];
          if (tiles.length > 0) {
            postLog(`pmtiles tiles template: ${tiles[0]}`);
          }
        })
        .catch((e) => {
          postError(e);
        });
    }
    const pmtilesDataset =
      kind === "kepler" ? resolvePmtilesDataset(data, meta) : null;
    if (pmtilesDataset) {
      state.store.dispatch(
        KeplerGl.addDataToMap({
          datasets: pmtilesDataset,
          config: getPmtilesConfig(data?.config, state.mapStyle),
          options: {
            autoCreateLayers: true,
            centerMap: true,
          },
        }),
      );
      postLog(
        `pmtiles dataset loaded as vector tile: ${pmtilesDataset.info?.label || "unknown"}`,
      );
    } else if (kind === "kepler") {
      const normalized = normalizeKeplerPayload(data);
      const hydrated = hydrateKeplerPayloadWithSchema(
        normalized.datasets,
        normalized.config,
      );
      const resolvedConfig = applyConfiguredBasemapFallback(
        hydrated.config,
        state.mapStyle,
      );
      state.store.dispatch(
        KeplerGl.addDataToMap({
          datasets: hydrated.datasets || [],
          config:
            isObject(resolvedConfig) && Object.keys(resolvedConfig).length > 0
              ? resolvedConfig
              : getStyleConfig(state.mapStyle),
          options: { centerMap: true },
        }),
      );
    } else {
      const dataset = toDataset(kind, data, meta);
      state.store.dispatch(
        KeplerGl.addDataToMap({
          datasets: dataset,
          config: getStyleConfig(state.mapStyle),
          options: { centerMap: true },
        }),
      );
    }
    postLog(
      `dataset loaded: ${kind}, features: ${meta?.featureCount ?? "unknown"}`,
    );
  }

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

  function wireToolbar() {
    const openFileButton = document.getElementById("toolbar-open-file");
    const openSourceButton = document.getElementById("toolbar-open-source");
    const refreshButton = document.getElementById("toolbar-refresh");
    const galleryButton = document.getElementById("toolbar-gallery");
    const openUrlButton = document.getElementById("toolbar-open-url");
    const urlInput = document.getElementById("toolbar-url-input");

    function loadFromInput() {
      if (!urlInput) {
        return;
      }
      const value = String(urlInput.value || "").trim();
      if (!value) {
        return;
      }
      vscode.postMessage({
        command: "loadView",
        viewName: "map.view",
        uri: value,
      });
    }

    if (openFileButton) {
      openFileButton.addEventListener("click", () => {
        vscode.postMessage({ command: "openGeoDataFile" });
      });
    }

    if (openSourceButton) {
      openSourceButton.addEventListener("click", () => {
        vscode.postMessage({ command: "openFile" });
      });
    }

    if (refreshButton) {
      refreshButton.addEventListener("click", () => {
        vscode.postMessage({ command: "refresh" });
      });
    }

    if (galleryButton) {
      galleryButton.addEventListener("click", () => {
        vscode.postMessage({ command: "showMapGallery" });
      });
    }

    if (openUrlButton) {
      openUrlButton.addEventListener("click", () => {
        loadFromInput();
      });
    }

    if (urlInput) {
      urlInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          loadFromInput();
        }
      });
    }
  }

  function bootstrap() {
    validateRuntime();
    state.store = createStore();
    const app = createApp(state.store, state.mapboxToken);
    const container = document.getElementById("map");
    if (typeof ReactDOM.createRoot === "function") {
      const root = ReactDOM.createRoot(container);
      root.render(app);
    } else {
      ReactDOM.render(app, container);
    }
    wireToolbar();
    persistWebviewState();
    state.isReady = true;
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
        postError(message.error || "Unknown webview error");
      }
    } catch (error) {
      postError(error);
    }
  });

  try {
    bootstrap();
  } catch (error) {
    postError(error);
    document.getElementById("map").innerHTML =
      `<div class="error">${error instanceof Error ? error.message : String(error)}</div>`;
  }
})();
