const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { CSVAdapter } = require("../out/data/adapters/csvAdapter.js");
const { GeoJSONAdapter } = require("../out/data/adapters/geojsonAdapter.js");
const { TopoJSONAdapter } = require("../out/data/adapters/topojsonAdapter.js");
const { KMLAdapter } = require("../out/data/adapters/kmlAdapter.js");
const { WKTAdapter } = require("../out/data/adapters/wktAdapter.js");
const {
  ShapefileAdapter,
} = require("../out/data/adapters/shapefileAdapter.js");
const {
  FlatGeobufAdapter,
} = require("../out/data/adapters/flatgeobufAdapter.js");
const { GMLAdapter } = require("../out/data/adapters/gmlAdapter.js");
const { IGCAdapter } = require("../out/data/adapters/igcAdapter.js");
const { XlsxAdapter } = require("../out/data/adapters/xlsxAdapter.js");
const { PMTilesAdapter } = require("../out/data/adapters/pmtilesAdapter.js");
const { applyStyleTypeFallback } = require("../media/styleSupport.js");

const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");

function uri(filePath) {
  return { fsPath: filePath };
}

test("Kepler 底图样式在不受支持时回退到当前设置值", () => {
  const result = applyStyleTypeFallback(
    {
      version: "v1",
      config: {
        mapStyle: {
          styleType: "muted_night",
          mapStyles: {},
          visibleLayerGroups: { road: true, water: true },
        },
      },
    },
    "darkmatter",
  );

  assert.equal(result.didFallback, true);
  assert.equal(result.originalStyleType, "muted_night");
  assert.equal(result.resolvedStyleType, "darkmatter");
  assert.equal(result.configWrapper.config.mapStyle.styleType, "darkmatter");
  assert.deepEqual(result.configWrapper.config.mapStyle.visibleLayerGroups, {
    road: true,
    water: true,
  });
});

test("Kepler 底图样式在当前项目支持时保留原值", () => {
  const result = applyStyleTypeFallback(
    {
      version: "v1",
      config: {
        mapStyle: {
          styleType: "positron",
          mapStyles: {},
        },
      },
    },
    "darkmatter",
  );

  assert.equal(result.didFallback, false);
  assert.equal(result.resolvedStyleType, "positron");
  assert.equal(result.configWrapper.config.mapStyle.styleType, "positron");
});

test("Kepler 自定义 mapStyles 存在时保留原 styleType", () => {
  const result = applyStyleTypeFallback(
    {
      version: "v1",
      config: {
        mapStyle: {
          styleType: "custom-style",
          mapStyles: {
            "custom-style": {
              style: {
                version: 8,
                sources: {},
                layers: [],
              },
            },
          },
        },
      },
    },
    "darkmatter",
  );

  assert.equal(result.didFallback, false);
  assert.equal(result.resolvedStyleType, "custom-style");
  assert.equal(result.configWrapper.config.mapStyle.styleType, "custom-style");
});

test("CSVAdapter 解析 csv 样例", async () => {
  const adapter = new CSVAdapter();
  const file = path.join(dataRoot, "csv", "usa-airports.csv");
  const result = await adapter.parse(uri(file));
  assert.ok(result.kind === "geojson" || result.kind === "table");
  assert.ok((result.meta?.featureCount || 0) > 0);
});

test("GeoJSONAdapter 解析 kepler map.json", async () => {
  const adapter = new GeoJSONAdapter();
  const file = path.join(dataRoot, "csv", "top-expat-destinations.map.json");
  const result = await adapter.parse(uri(file));
  assert.equal(result.kind, "kepler");
  assert.ok(result.data?.config);
  assert.ok(Array.isArray(result.data?.datasets));
});

test("GeoJSONAdapter 解析 kepler kgl.json", async () => {
  const adapter = new GeoJSONAdapter();
  const file = path.join(dataRoot, "csv", "top-expat-destinations.kgl.json");
  const result = await adapter.parse(uri(file));
  assert.equal(result.kind, "kepler");
  assert.ok(result.data?.config);
});

test("GeoJSONAdapter 解析 kepler datasets json 数组", async () => {
  const adapter = new GeoJSONAdapter();
  const file = path.join(dataRoot, "csv", "top-expat-destinations.json");
  const result = await adapter.parse(uri(file));
  assert.equal(result.kind, "kepler");
  assert.ok(Array.isArray(result.data?.datasets));
  assert.ok(result.data.datasets.length > 0);
  assert.ok(result.meta?.hasDatasets);
});

test("TopoJSONAdapter 解析 topojson 样例", async () => {
  const adapter = new TopoJSONAdapter();
  const file = path.join(dataRoot, "topojson", "usa-albers-counties.topo.json");
  const result = await adapter.parse(uri(file));
  assert.equal(result.kind, "geojson");
  assert.ok((result.meta?.featureCount || 0) > 0);
});

test("KMLAdapter 解析 kml 样例", async () => {
  const adapter = new KMLAdapter();
  const file = path.join(dataRoot, "kml", "lines.kml");
  const result = await adapter.parse(uri(file));
  assert.equal(result.kind, "geojson");
  assert.ok((result.meta?.featureCount || 0) > 0);
});

test("WKTAdapter 解析 wkt 样例", async () => {
  const adapter = new WKTAdapter();
  const file = path.join(dataRoot, "wkt", "polygon.wkt");
  const result = await adapter.parse(uri(file));
  assert.equal(result.kind, "geojson");
  assert.ok((result.meta?.featureCount || 0) > 0);
});

test("ShapefileAdapter 解析 shp 样例", async () => {
  const adapter = new ShapefileAdapter();
  const file = path.join(dataRoot, "shapefiles", "World_Cities.shp");
  const result = await adapter.parse(uri(file));
  assert.equal(result.kind, "geojson");
  assert.ok((result.meta?.featureCount || 0) > 0);
});

test("ShapefileAdapter 解析 zip 样例（同目录已解压）", async () => {
  const adapter = new ShapefileAdapter();
  const file = path.join(dataRoot, "shapefiles", "World_Cities.zip");
  const result = await adapter.parse(uri(file));
  assert.equal(result.kind, "geojson");
  assert.ok((result.meta?.featureCount || 0) > 0);
});

test("FlatGeobufAdapter 解析 fgb 样例", async () => {
  const adapter = new FlatGeobufAdapter();
  const file = path.join(dataRoot, "fgb", "countries.fgb");
  const result = await adapter.parse(uri(file));
  assert.equal(result.kind, "geojson");
  assert.ok((result.meta?.featureCount || 0) > 0);
});

test("GMLAdapter 解析 gml 样例", async () => {
  const adapter = new GMLAdapter();
  const file = path.join(dataRoot, "gml", "rectangle.gml");
  const result = await adapter.parse(uri(file));
  assert.equal(result.kind, "geojson");
  assert.ok((result.meta?.featureCount || 0) > 0);
});

test("IGCAdapter 解析 igc 样例", async () => {
  const adapter = new IGCAdapter();
  const file = path.join(dataRoot, "igc", "flight_demo_canada.igc");
  const result = await adapter.parse(uri(file));
  assert.equal(result.kind, "geojson");
  assert.ok((result.meta?.featureCount || 0) > 0);
});

test("XlsxAdapter 解析 xlsx 样例（同目录 csv 兜底）", async () => {
  const adapter = new XlsxAdapter();
  const file = path.join(dataRoot, "excel", "usa-state-capitals.xlsx");
  const result = await adapter.parse(uri(file));
  assert.ok(result.kind === "geojson" || result.kind === "table");
  assert.ok((result.meta?.featureCount || 0) > 0);
});

test("PMTilesAdapter 解析 pmtiles 样例", async () => {
  const adapter = new PMTilesAdapter();
  const file = path.join(dataRoot, "pmtiles", "openclaw.pmtiles");
  const result = await adapter.parse(uri(file));
  assert.equal(result.kind, "kepler");
  assert.ok(result.data?.config);
  assert.ok(result.data?.datasets);
  assert.ok(result.meta?.pmtiles?.tilejsonUrl);
  assert.ok(result.meta?.pmtiles?.tileTemplate);

  const dataset = Array.isArray(result.data.datasets)
    ? result.data.datasets[0]
    : result.data.datasets;
  assert.ok(dataset);
  assert.equal(dataset.info?.type, "vector-tile");
  assert.equal(dataset.metadata?.type, "remote");
  assert.equal(dataset.metadata?.remoteTileFormat, "mvt");
  assert.equal(
    dataset.metadata?.tilesetDataUrl,
    result.meta.pmtiles.tileTemplate,
  );
  assert.equal(
    dataset.metadata?.tilesetMetadataUrl,
    result.meta.pmtiles.tilejsonUrl,
  );
  assert.ok(Array.isArray(dataset.data?.fields));
  assert.ok(dataset.data.fields.some((field) => field.name === "city"));

  const tilejsonRes = await fetch(result.meta.pmtiles.tilejsonUrl);
  assert.equal(tilejsonRes.status, 200);
  const tilejson = await tilejsonRes.json();
  assert.ok(Array.isArray(tilejson.tiles));
  assert.ok(tilejson.tiles.length > 0);

  const minzoom = Number(tilejson.minzoom ?? 0);
  const tileUrl = String(tilejson.tiles[0])
    .replace("{z}", String(minzoom))
    .replace("{x}", "0")
    .replace("{y}", "0");
  const tileRes = await fetch(tileUrl);
  assert.equal(tileRes.status, 200);
  const bytes = await tileRes.arrayBuffer();
  assert.ok(bytes.byteLength > 0);
});
