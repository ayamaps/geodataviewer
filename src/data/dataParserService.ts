import * as vscode from "vscode";
import { Logger } from "../utils/logger";
import { BaseAdapter, ParsedForKepler } from "./adapters/baseAdapter";
import { GeoJSONAdapter } from "./adapters/geojsonAdapter";
import { CSVAdapter } from "./adapters/csvAdapter";
import { KMLAdapter } from "./adapters/kmlAdapter";
import { GPXAdapter } from "./adapters/gpxAdapter";
import { WKTAdapter } from "./adapters/wktAdapter";
import { ShapefileAdapter } from "./adapters/shapefileAdapter";
import { FlatGeobufAdapter } from "./adapters/flatgeobufAdapter";
import { TopoJSONAdapter } from "./adapters/topojsonAdapter";
import { ParquetAdapter } from "./adapters/parquetAdapter";
import { GMLAdapter } from "./adapters/gmlAdapter";
import { IGCAdapter } from "./adapters/igcAdapter";
import { XlsxAdapter } from "./adapters/xlsxAdapter";
import { PMTilesAdapter } from "./adapters/pmtilesAdapter";
import { LargeFileHandler } from "./largeFileHandler";

export class DataParserService {
  private logger = new Logger("DataParserService");
  private adapters: BaseAdapter[] = [];
  private parseCache = new Map<
    string,
    { data: ParsedForKepler; timestamp: number }
  >();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.initializeAdapters();
  }

  private initializeAdapters(): void {
    this.adapters = [
      new GeoJSONAdapter(),
      new CSVAdapter(),
      new KMLAdapter(),
      new GPXAdapter(),
      new GMLAdapter(),
      new IGCAdapter(),
      new WKTAdapter(),
      new ShapefileAdapter(),
      new FlatGeobufAdapter(),
      new TopoJSONAdapter(),
      new ParquetAdapter(),
      new XlsxAdapter(),
      new PMTilesAdapter(),
    ];
  }

  async parseFile(fileUri: vscode.Uri): Promise<ParsedForKepler> {
    const filePath = fileUri.fsPath;
    const fileName = fileUri.path.split("/").pop() || "";

    this.logger.info(`Parsing file: ${fileName}`);

    // Check cache first
    const cacheKey = filePath;
    const cached = this.parseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      this.logger.debug(`Cache hit for ${fileName}`);
      return cached.data;
    }

    try {
      // Check for large file handling
      const fileCheck = await LargeFileHandler.shouldUsePreviewMode(fileUri);

      if (fileCheck.usePreview) {
        const shouldContinue = await LargeFileHandler.showPreviewWarning(
          fileName,
          fileCheck.fileSize,
          fileCheck.limit!,
        );

        if (!shouldContinue) {
          throw new Error("User cancelled large file preview");
        }
      }

      // Find appropriate adapter
      const adapter = this.adapters.find((a) => a.canHandle(fileName));
      if (!adapter) {
        throw new Error(`Unsupported file format: ${fileName}`);
      }

      this.logger.debug(`Using adapter: ${adapter.id} for ${fileName}`);

      // Parse the file
      let result = await adapter.parse(fileUri);

      // Apply preview mode if needed
      if (fileCheck.usePreview && fileCheck.limit) {
        if (result.kind === "geojson" && result.data.features) {
          result.data = LargeFileHandler.sampleGeoJSON(
            result.data,
            fileCheck.limit,
          );
          result.meta = result.data.meta;
        } else if (result.kind === "table" && result.rows) {
          result = LargeFileHandler.sampleTableData(result, fileCheck.limit);
          result.meta = result.meta;
        }
      }

      // Cache the result
      this.parseCache.set(cacheKey, {
        data: result,
        timestamp: Date.now(),
      });

      this.logger.info(
        `Successfully parsed ${fileName}: ${result.meta?.featureCount || "unknown"} features`,
      );
      return result;
    } catch (error) {
      this.logger.error(`Failed to parse ${fileName}:`, error);
      throw new Error(
        `Failed to parse ${fileName}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  clearCache(): void {
    this.parseCache.clear();
    this.logger.info("Parse cache cleared");
  }

  invalidateCache(fileUri: vscode.Uri): void {
    this.parseCache.delete(fileUri.fsPath);
  }

  getCacheSize(): number {
    return this.parseCache.size;
  }

  static isSupportedFile(filePath: string): boolean {
    const supportedExtensions = [
      ".geojson",
      ".json",
      ".topojson",
      ".topo.json",
      ".kml",
      ".gpx",
      ".wkt",
      ".csv",
      ".tsv",
      ".gml",
      ".igc",
      ".xlsx",
      ".config",
      ".fgb",
      ".parquet",
      ".geoparquet",
      ".gpq",
      ".shp",
      ".zip",
      ".map.json",
      ".kgl.json",
      ".pmtiles",
    ];

    const ext = filePath.toLowerCase();
    return supportedExtensions.some((supported) => ext.endsWith(supported));
  }
}
