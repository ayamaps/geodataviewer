function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getStyleConfig(mapStyle: string) {
  return {
    version: "v1",
    config: {
      mapStyle: {
        styleType: mapStyle || "positron",
      },
    },
  };
}

function isKeplerInnerConfig(config: unknown): config is Record<string, any> {
  if (!isObject(config)) {
    return false;
  }
  return Boolean(config.visState || config.mapState || config.mapStyle);
}

function isKeplerConfigWrapper(config: unknown): config is { version?: string; config: Record<string, any> } {
  return isObject(config) && isKeplerInnerConfig(config.config);
}

export function normalizeKeplerConfig(config: unknown): Record<string, any> {
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

export function normalizeKeplerPayload(data: any) {
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

export function applyConfiguredBasemapFallback(
  config: unknown,
  fallbackMapStyle: string,
) {
  const normalized = normalizeKeplerConfig(config);
  if (!isObject(normalized) || Object.keys(normalized).length === 0) {
    return normalized;
  }

  const styleSupport = (globalThis as any).GeoDataViewerStyleSupport;
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
  return {
    configWrapper: result?.configWrapper || normalized,
    didFallback: Boolean(result?.didFallback),
    originalStyleType: result?.originalStyleType,
    resolvedStyleType: result?.resolvedStyleType,
  };
}

export function isVectorTileDataset(dataset: unknown) {
  return (
    isObject(dataset) &&
    isObject(dataset.info) &&
    dataset.info.type === "vector-tile" &&
    isObject(dataset.metadata) &&
    typeof dataset.metadata.tilesetDataUrl === "string"
  );
}

export function resolvePmtilesDataset(data: any, meta: any) {
  if (!meta?.pmtiles) {
    return null;
  }
  const normalized = normalizeKeplerPayload(data);
  return normalized.datasets.find(isVectorTileDataset) || null;
}

export function getPmtilesConfig(config: unknown, mapStyle: string) {
  const fallbackResult = applyConfiguredBasemapFallback(config, mapStyle);
  const normalized = fallbackResult.configWrapper || normalizeKeplerConfig(config);
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

export function hydrateKeplerPayloadWithSchema(
  keplerModule: any,
  datasets: any[],
  config: unknown,
) {
  if (
    !keplerModule.KeplerGlSchema ||
    typeof keplerModule.KeplerGlSchema.load !== "function"
  ) {
    return { datasets, config };
  }

  const loaded = keplerModule.KeplerGlSchema.load(datasets, config || {});
  return {
    datasets: loaded?.datasets || datasets,
    config: loaded?.config || config,
  };
}

function rowsToCsv(rows: Record<string, unknown>[]) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return "";
  }
  const headers = Object.keys(rows[0]);
  const headerLine = headers.join(",");
  const body = rows
    .map((row) => headers
      .map((header) => {
        const value = row[header] ?? "";
        const text = String(value).replace(/"/g, '""');
        return `"${text}"`;
      })
      .join(","))
    .join("\n");
  return `${headerLine}\n${body}`;
}

export function toDataset(
  keplerModule: any,
  kind: string,
  data: any,
) {
  if (kind === "geojson") {
    return {
      info: { id: "dataset-geojson", label: "GeoJSON" },
      data: keplerModule.processGeojson(data),
    };
  }

  if (kind === "table") {
    const rows = Array.isArray(data?.rows)
      ? data.rows
      : Array.isArray(data)
        ? data
        : [];
    return {
      info: { id: "dataset-table", label: "Table" },
      data: keplerModule.processCsvData(rowsToCsv(rows)),
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

export function hasObjectKeys(value: unknown) {
  return isObject(value) && Object.keys(value).length > 0;
}
