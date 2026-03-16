export interface MapGalleryItem {
  readonly name: string;
  readonly description: string;
  readonly target: string;
}

export const MAP_GALLERY_RAW_BASE_URL =
  "https://raw.githubusercontent.com/ayamaps/geodataviewer/refs/heads/main/";

export const COMMAND_IDS = {
  openCurrentFile: "geoDataViewer.openCurrentFile",
  previewOnMap: "geoDataViewer.previewOnMap",
  reloadMap: "geoDataViewer.reloadMap",
  openFromUrl: "geoDataViewer.openFromUrl",
  mapGallery: "geoDataViewer.mapGallery",
  legacyMapView: "map.view",
  legacyMapViewFromUrl: "map.view.url",
  legacyMapGallery: "map.gallery",
} as const;

export const OPEN_FILE_FILTERS: Record<string, string[]> = {
  GeoJSON: ["geojson", "json", "config", "map.json", "kgl.json"],
  TopoJSON: ["topojson"],
  CSV: ["csv", "tsv"],
  Excel: ["xlsx"],
  KML: ["kml"],
  GPX: ["gpx"],
  GML: ["gml"],
  IGC: ["igc"],
  WKT: ["wkt"],
  Shapefile: ["shp", "zip"],
  FlatGeobuf: ["fgb"],
  Parquet: ["parquet", "geoparquet", "gpq"],
  PMTiles: ["pmtiles"],
};

export const MAP_GALLERY_ITEMS: readonly MapGalleryItem[] = [
  {
    name: "Chicago Bike Routes",
    target: "data/kgl/chicago-bike-routes.map.json",
    description: "GitHub sample map config",
  },
  {
    name: "Chicago Green Roofs",
    target: "data/csv/chicago-green-roofs.map.json",
    description: "GitHub sample map config",
  },
  {
    name: "Chicago Traffic Crashes",
    target: "data/csv/chicago-traffic-crashes.map.json",
    description: "GitHub sample map config",
  },
  {
    name: "Top Expat Destinations",
    target: "data/csv/top-expat-destinations.map.json",
    description: "GitHub sample map config",
  },
  {
    name: "USA Airports",
    target: "data/csv/usa-airports.map.json",
    description: "GitHub sample map config",
  },
  {
    name: "USA Counties",
    target: "data/topojson/usa-albers-counties.topo.json",
    description: "GitHub TopoJSON sample",
  },
  {
    name: "World Cities",
    target: "data/shapefiles/World_Cities.geojson",
    description: "GitHub GeoJSON sample",
  },
  {
    name: "Major World Rivers",
    target: "data/shapefiles/MajorRivers.geojson",
    description: "GitHub GeoJSON sample",
  },
  {
    name: "World Lakes",
    target: "data/shapefiles/ne_10m_lakes.geojson",
    description: "GitHub GeoJSON sample",
  },
  {
    name: "Countries",
    target: "data/fgb/countries.fgb",
    description: "GitHub FlatGeobuf sample",
  },
  {
    name: "OpenClaw PMTiles",
    target: "data/pmtiles/openclaw.pmtiles",
    description: "GitHub PMTiles sample",
  },
];

export function resolveMapGalleryTarget(target: string): string {
  return new URL(
    target.replace(/^\/+/, ""),
    MAP_GALLERY_RAW_BASE_URL,
  ).toString();
}
