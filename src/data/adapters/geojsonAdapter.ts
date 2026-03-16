import * as fs from "fs/promises";
import { BaseAdapter, ParsedForKepler } from "./baseAdapter";

export class GeoJSONAdapter extends BaseAdapter {
  readonly id = "geojson";
  readonly supportedExtensions = [
    ".geojson",
    ".json",
    ".config",
    ".kgl.json",
    ".map.json",
  ];

  async parse(fileUri: { fsPath: string }): Promise<ParsedForKepler> {
    const content = await fs.readFile(fileUri.fsPath, "utf-8");

    try {
      const data = JSON.parse(content);

      // Handle different GeoJSON structures
      if (data.type === "FeatureCollection") {
        return this.parseFeatureCollection(data);
      } else if (data.type === "Feature") {
        return this.parseSingleFeature(data);
      } else if (Array.isArray(data) && this.isKeplerDatasetArray(data)) {
        return this.parseKeplerGLFormat({ datasets: data });
      } else if (this.isKeplerPayload(data)) {
        // Kepler.gl format
        return this.parseKeplerGLFormat(data);
      } else if (Array.isArray(data)) {
        return this.parseJsonArrayAsTable(data);
      } else {
        throw new Error("Invalid GeoJSON format");
      }
    } catch (error) {
      throw new Error(
        `Failed to parse GeoJSON: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  private parseFeatureCollection(data: any): ParsedForKepler {
    const featureCount = data.features?.length || 0;
    const bbox = this.calculateBBox(data.features);
    const geometryType = this.inferGeometryType(data.features);

    return {
      kind: "geojson",
      data: data,
      meta: {
        featureCount,
        geometryType,
        bbox,
      },
    };
  }

  private parseSingleFeature(data: any): ParsedForKepler {
    const featureCollection = {
      type: "FeatureCollection",
      features: [data],
    };

    return {
      kind: "geojson",
      data: featureCollection,
      meta: {
        featureCount: 1,
        geometryType: data.geometry?.type,
        bbox: this.calculateBBox([data]),
      },
    };
  }

  private parseKeplerGLFormat(data: any): ParsedForKepler {
    const normalized = this.normalizeKeplerPayload(data);

    return {
      kind: "kepler",
      data: normalized,
      meta: {
        featureCount: normalized.datasets.length,
        keplerFormat: true,
        hasConfig: this.hasKeplerConfig(normalized.config),
        hasDatasets: normalized.datasets.length > 0,
      },
    };
  }

  private isKeplerPayload(data: any): boolean {
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    if (data.type === "FeatureCollection" || data.type === "Feature")
      return false;
    if (this.isKeplerDatasetArray(data.datasets)) return true;
    if (this.isKeplerDataset(data.datasets)) return true;
    if (this.hasKeplerConfig(data.config)) return true;
    if (this.hasKeplerConfig(data)) return true;
    return false;
  }

  private parseJsonArrayAsTable(data: any[]): ParsedForKepler {
    const firstRow = data[0] || {};
    const fields = Object.keys(firstRow).map((name) => ({
      name,
      type: typeof firstRow[name],
    }));
    return {
      kind: "table",
      rows: data,
      fields,
      meta: {
        featureCount: data.length,
      },
    };
  }

  private normalizeKeplerPayload(data: any): {
    config: any;
    datasets: any[];
    info: any;
    version: string;
  } {
    const datasets = this.normalizeKeplerDatasets(data?.datasets);
    const config = this.normalizeKeplerConfig(data?.config ?? data);
    const info =
      data && typeof data.info === "object" && !Array.isArray(data.info)
        ? data.info
        : {};
    const version = typeof data?.version === "string" ? data.version : "v1";
    return { config, datasets, info, version };
  }

  private normalizeKeplerDatasets(rawDatasets: any): any[] {
    if (this.isKeplerDatasetArray(rawDatasets)) {
      return rawDatasets;
    }
    if (this.isKeplerDataset(rawDatasets)) {
      return [rawDatasets];
    }
    return [];
  }

  private normalizeKeplerConfig(rawConfig: any): any {
    if (
      !rawConfig ||
      typeof rawConfig !== "object" ||
      Array.isArray(rawConfig)
    ) {
      return {};
    }
    if (this.isKeplerConfigWrapper(rawConfig)) {
      return rawConfig;
    }
    if (this.isKeplerInnerConfig(rawConfig)) {
      return {
        version:
          typeof rawConfig.version === "string" ? rawConfig.version : "v1",
        config: rawConfig,
      };
    }
    return {};
  }

  private hasKeplerConfig(rawConfig: any): boolean {
    if (
      !rawConfig ||
      typeof rawConfig !== "object" ||
      Array.isArray(rawConfig)
    ) {
      return false;
    }
    return (
      this.isKeplerConfigWrapper(rawConfig) ||
      this.isKeplerInnerConfig(rawConfig)
    );
  }

  private isKeplerConfigWrapper(rawConfig: any): boolean {
    return Boolean(
      rawConfig &&
        typeof rawConfig === "object" &&
        !Array.isArray(rawConfig) &&
        rawConfig.config &&
        this.isKeplerInnerConfig(rawConfig.config),
    );
  }

  private isKeplerInnerConfig(rawConfig: any): boolean {
    if (
      !rawConfig ||
      typeof rawConfig !== "object" ||
      Array.isArray(rawConfig)
    ) {
      return false;
    }
    return Boolean(
      rawConfig.visState || rawConfig.mapState || rawConfig.mapStyle,
    );
  }

  private isKeplerDatasetArray(rawDatasets: any): rawDatasets is any[] {
    if (!Array.isArray(rawDatasets)) return false;
    if (rawDatasets.length === 0) return false;
    return rawDatasets.every((dataset) => this.isKeplerDataset(dataset));
  }

  private isKeplerDataset(dataset: any): boolean {
    if (!dataset || typeof dataset !== "object" || Array.isArray(dataset)) {
      return false;
    }
    if (dataset.info && dataset.data) {
      return true;
    }

    const payload = dataset.data;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return false;
    }
    if (
      Array.isArray(payload.fields) &&
      (Array.isArray(payload.rows) || Array.isArray(payload.allData))
    ) {
      return true;
    }
    if (payload.type === "FeatureCollection" || payload.type === "Feature") {
      return true;
    }
    return false;
  }

  private calculateBBox(
    features: any[],
  ): [number, number, number, number] | undefined {
    if (!features || features.length === 0) return undefined;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    let hasValidGeometry = false;

    for (const feature of features) {
      const geometry = feature.geometry;
      if (!geometry || !geometry.coordinates) continue;

      hasValidGeometry = true;
      const coords = this.extractCoordinates(geometry.coordinates);

      for (const [x, y] of coords) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    return hasValidGeometry ? [minX, minY, maxX, maxY] : undefined;
  }

  private extractCoordinates(coords: any): number[][] {
    if (!Array.isArray(coords)) return [];

    // Handle different coordinate structures
    if (
      coords.length === 2 &&
      typeof coords[0] === "number" &&
      typeof coords[1] === "number"
    ) {
      return [coords as number[]];
    }

    // Recursively extract coordinates from nested arrays
    const result: number[][] = [];
    for (const coord of coords) {
      if (Array.isArray(coord)) {
        result.push(...this.extractCoordinates(coord));
      }
    }
    return result;
  }

  private inferGeometryType(features: any[]): string | undefined {
    if (!features || features.length === 0) return undefined;

    const types = new Set(
      features.map((f) => f.geometry?.type).filter(Boolean),
    );

    if (types.size === 1) return Array.from(types)[0];
    if (types.size > 1) return "Mixed";
    return undefined;
  }
}
