import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as path from 'node:path';
import { PMTiles, TileType, type RangeResponse, type Source } from 'pmtiles';
import { BaseAdapter, ParsedForKepler } from './baseAdapter';

type PmtilesRegistration = {
    id: string;
    origin: string;
    tilejsonUrl: string;
    tileTemplate: string;
};

type KeplerField = {
    analyzerType: 'BOOLEAN' | 'FLOAT' | 'INT' | 'STRING';
    format: string;
    name: string;
    type: 'boolean' | 'integer' | 'real' | 'string';
};

type PMTilesVectorLayer = {
    description?: string;
    fields?: Record<string, unknown>;
    id?: string;
    maxzoom?: number;
    minzoom?: number;
};

type PMTilesTilestatsAttribute = {
    attribute?: string;
    type?: string;
};

type PMTilesTilestatsLayer = {
    attributes?: PMTilesTilestatsAttribute[];
    count?: number;
    geometry?: string;
    layer?: string;
};

class LocalFileSource implements Source {
    private readonly filePath: string;

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    getKey(): string {
        return `file://${this.filePath}`;
    }

    async getBytes(offset: number, length: number): Promise<RangeResponse> {
        const handle = await fs.open(this.filePath, 'r');
        try {
            const buffer = Buffer.alloc(length);
            const { bytesRead } = await handle.read(buffer, 0, length, offset);
            return { data: buffer.subarray(0, bytesRead).buffer };
        } finally {
            await handle.close();
        }
    }
}

class PmtilesTileServer {
    private server: http.Server | undefined;
    private origin: string | undefined;
    private readonly byId = new Map<string, { pmtiles: PMTiles }>();

    async ensureStarted(): Promise<void> {
        if (this.server && this.origin) return;

        this.server = http.createServer((req, res) => {
            void this.handle(req, res);
        });

        await new Promise<void>((resolve, reject) => {
            this.server!.once('error', reject);
            this.server!.listen(0, '127.0.0.1', () => resolve());
        });

        const address = this.server.address();
        if (!address || typeof address === 'string') {
            throw new Error('PMTiles server failed to start');
        }

        this.server.unref();
        this.origin = `http://127.0.0.1:${address.port}`;
    }

    async register(filePath: string): Promise<PmtilesRegistration> {
        await this.ensureStarted();

        const id = crypto.createHash('sha1').update(filePath).digest('base64url');
        if (!this.byId.has(id)) {
            const pmtiles = new PMTiles(new LocalFileSource(filePath));
            this.byId.set(id, { pmtiles });
        }

        const origin = this.origin!;
        return {
            id,
            origin,
            tilejsonUrl: `${origin}/pmtiles/tilejson/${id}.json`,
            tileTemplate: `${origin}/pmtiles/tiles/${id}/{z}/{x}/{y}.mvt`
        };
    }

    async getHeader(id: string) {
        const entry = this.byId.get(id);
        if (!entry) throw new Error('Unknown PMTiles id');
        return entry.pmtiles.getHeader();
    }

    async getMetadata(id: string) {
        const entry = this.byId.get(id);
        if (!entry) throw new Error('Unknown PMTiles id');
        return entry.pmtiles.getMetadata();
    }

    async getTile(id: string, z: number, x: number, y: number) {
        const entry = this.byId.get(id);
        if (!entry) throw new Error('Unknown PMTiles id');
        return entry.pmtiles.getZxy(z, x, y);
    }

    private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const url = new URL(req.url || '/', this.origin || 'http://127.0.0.1');
            const pathname = url.pathname;

            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', '*');
            if (req.method === 'OPTIONS') {
                res.statusCode = 204;
                res.end();
                return;
            }

            const tilejsonMatch = pathname.match(/^\/pmtiles\/tilejson\/([A-Za-z0-9_-]+)\.json$/);
            if (tilejsonMatch) {
                const id = tilejsonMatch[1];
                const header = await this.getHeader(id);
                const metadata = await this.getMetadata(id).catch(() => ({}));

                const ext = header.tileType === TileType.Mvt ? 'mvt' : 'bin';
                const tileTemplate = `${this.origin}/pmtiles/tiles/${id}/{z}/{x}/{y}.${ext}`;

                const tilejson = {
                    tilejson: '3.0.0',
                    name: (metadata as any)?.name || id,
                    minzoom: header.minZoom,
                    maxzoom: header.maxZoom,
                    bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
                    center: [header.centerLon, header.centerLat, header.centerZoom],
                    tiles: [tileTemplate],
                    vector_layers: (metadata as any)?.vector_layers
                };

                const body = JSON.stringify(tilejson);
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(body);
                return;
            }

            const tileMatch = pathname.match(/^\/pmtiles\/tiles\/([A-Za-z0-9_-]+)\/(\d+)\/(\d+)\/(\d+)\.(\w+)$/);
            if (tileMatch) {
                const id = tileMatch[1];
                const z = Number(tileMatch[2]);
                const x = Number(tileMatch[3]);
                const y = Number(tileMatch[4]);

                const tile = await this.getTile(id, z, x, y);
                if (!tile?.data) {
                    res.statusCode = 204;
                    res.end();
                    return;
                }

                const header = await this.getHeader(id);
                if (header.tileType === TileType.Mvt) {
                    res.setHeader('Content-Type', 'application/x-protobuf');
                } else if (header.tileType === TileType.Png) {
                    res.setHeader('Content-Type', 'image/png');
                } else if (header.tileType === TileType.Jpeg) {
                    res.setHeader('Content-Type', 'image/jpeg');
                } else if (header.tileType === TileType.Webp) {
                    res.setHeader('Content-Type', 'image/webp');
                } else if (header.tileType === TileType.Avif) {
                    res.setHeader('Content-Type', 'image/avif');
                } else {
                    res.setHeader('Content-Type', 'application/octet-stream');
                }

                res.statusCode = 200;
                res.end(Buffer.from(tile.data));
                return;
            }

            res.statusCode = 404;
            res.end();
        } catch (error) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end(error instanceof Error ? error.message : 'Unknown error');
        }
    }
}

const server = new PmtilesTileServer();
const FIELD_TYPE_PRIORITY: Record<KeplerField['type'], number> = {
    string: 0,
    boolean: 1,
    integer: 2,
    real: 3
};

function normalizeFieldType(rawType: unknown): Pick<KeplerField, 'analyzerType' | 'type'> {
    const type = String(rawType || '').trim().toLowerCase();
    if (type === 'bool' || type === 'boolean') {
        return { analyzerType: 'BOOLEAN', type: 'boolean' };
    }
    if (
        type === 'int' ||
        type === 'integer' ||
        type === 'int32' ||
        type === 'int64' ||
        type === 'uint32' ||
        type === 'uint64'
    ) {
        return { analyzerType: 'INT', type: 'integer' };
    }
    if (
        type === 'double' ||
        type === 'float' ||
        type === 'float32' ||
        type === 'float64' ||
        type === 'number' ||
        type === 'numeric' ||
        type === 'real'
    ) {
        return { analyzerType: 'FLOAT', type: 'real' };
    }
    return { analyzerType: 'STRING', type: 'string' };
}

function upsertField(fieldsByName: Map<string, KeplerField>, name: unknown, rawType: unknown): void {
    const fieldName = String(name || '').trim();
    if (!fieldName) {
        return;
    }

    const nextField: KeplerField = {
        ...normalizeFieldType(rawType),
        format: '',
        name: fieldName
    };
    const existingField = fieldsByName.get(fieldName);
    if (!existingField || FIELD_TYPE_PRIORITY[nextField.type] > FIELD_TYPE_PRIORITY[existingField.type]) {
        fieldsByName.set(fieldName, nextField);
    }
}

function extractFields(rawMetadata: Record<string, unknown>): KeplerField[] {
    const fieldsByName = new Map<string, KeplerField>();
    const tilestatsLayers = Array.isArray((rawMetadata.tilestats as any)?.layers)
        ? ((rawMetadata.tilestats as any).layers as PMTilesTilestatsLayer[])
        : [];
    for (const layer of tilestatsLayers) {
        const attributes = Array.isArray(layer?.attributes) ? layer.attributes : [];
        for (const attribute of attributes) {
            upsertField(fieldsByName, attribute?.attribute, attribute?.type);
        }
    }

    const vectorLayers = Array.isArray(rawMetadata.vector_layers)
        ? (rawMetadata.vector_layers as PMTilesVectorLayer[])
        : [];
    for (const layer of vectorLayers) {
        const layerFields = layer?.fields;
        if (!layerFields || typeof layerFields !== 'object') {
            continue;
        }

        for (const [fieldName, fieldType] of Object.entries(layerFields)) {
            upsertField(fieldsByName, fieldName, fieldType);
        }
    }

    return Array.from(fieldsByName.values());
}

function extractVectorLayerIds(rawMetadata: Record<string, unknown>): string[] {
    const vectorLayers = Array.isArray(rawMetadata.vector_layers)
        ? (rawMetadata.vector_layers as PMTilesVectorLayer[])
        : [];
    return vectorLayers.map(layer => layer?.id).filter((layerId): layerId is string => Boolean(layerId));
}

function extractGeometryTypes(rawMetadata: Record<string, unknown>): string[] {
    const tilestatsLayers = Array.isArray((rawMetadata.tilestats as any)?.layers)
        ? ((rawMetadata.tilestats as any).layers as PMTilesTilestatsLayer[])
        : [];
    const geometryTypes = new Set<string>();
    for (const layer of tilestatsLayers) {
        const geometryType = String(layer?.geometry || '').trim();
        if (geometryType) {
            geometryTypes.add(geometryType);
        }
    }
    return Array.from(geometryTypes);
}

function extractFeatureCount(rawMetadata: Record<string, unknown>): number | undefined {
    const tilestatsLayers = Array.isArray((rawMetadata.tilestats as any)?.layers)
        ? ((rawMetadata.tilestats as any).layers as PMTilesTilestatsLayer[])
        : [];
    const count = tilestatsLayers.reduce((sum, layer) => {
        return sum + (typeof layer?.count === 'number' ? layer.count : 0);
    }, 0);
    return count > 0 ? count : undefined;
}

export class PMTilesAdapter extends BaseAdapter {
    readonly id = 'pmtiles';
    readonly supportedExtensions = ['.pmtiles'];

    async parse(fileUri: { fsPath: string }): Promise<ParsedForKepler> {
        const reg = await server.register(fileUri.fsPath);
        const header = await server.getHeader(reg.id);
        const metadata = (await server.getMetadata(reg.id).catch(() => ({}))) as Record<string, unknown>;

        if (header.tileType !== TileType.Mvt) {
            throw new Error(`Unsupported PMTiles tile type: ${header.tileType}`);
        }

        const datasetLabel = String(metadata.name || '').trim() || path.basename(fileUri.fsPath);
        const vectorLayerIds = extractVectorLayerIds(metadata);
        const fields = extractFields(metadata);
        const geometryTypes = extractGeometryTypes(metadata);
        const featureCount = extractFeatureCount(metadata);
        const bounds = [header.minLon, header.minLat, header.maxLon, header.maxLat] as [number, number, number, number];
        const center = [header.centerLon, header.centerLat, header.centerZoom] as [number, number, number];

        const dataset = {
            info: {
                format: 'rows',
                id: reg.id,
                label: datasetLabel,
                type: 'vector-tile'
            },
            data: {
                fields,
                rows: []
            },
            metadata: {
                bounds,
                center,
                fields,
                geometryTypes,
                maxZoom: header.maxZoom,
                metaJson: metadata,
                minZoom: header.minZoom,
                pmtilesType: 'mvt',
                remoteTileFormat: 'mvt',
                tilesetDataUrl: reg.tileTemplate,
                tilesetMetadataUrl: reg.tilejsonUrl,
                type: 'remote',
                vectorLayerIds
            },
            supportedFilterTypes: ['real', 'integer', 'boolean'],
            disableDataOperation: true
        };

        const config = {
            config: {
                mapState: {
                    bearing: 0,
                    dragRotate: false,
                    isSplit: false,
                    latitude: header.centerLat,
                    longitude: header.centerLon,
                    pitch: 0,
                    zoom: header.centerZoom
                },
                mapStyle: {
                    styleType: 'positron'
                },
                visState: {
                    filters: [],
                    layers: [],
                    interactionConfig: {
                        brush: { enabled: false, size: 0.5 },
                        coordinate: { enabled: false },
                        tooltip: { enabled: true, fieldsToShow: {} }
                    },
                    layerBlending: 'normal',
                    animationConfig: { currentTime: null, speed: 1 }
                }
            },
            version: 'v1'
        };

        return {
            kind: 'kepler',
            data: {
                datasets: dataset,
                config,
                info: {}
            },
            meta: {
                featureCount,
                geometryType: geometryTypes.length === 1 ? geometryTypes[0] : 'Mixed',
                pmtiles: {
                    bounds,
                    center,
                    datasetLabel,
                    remoteTileFormat: 'mvt',
                    sourceFormat: 'pmtiles',
                    tileTemplate: reg.tileTemplate,
                    tilejsonUrl: reg.tilejsonUrl,
                    maxzoom: header.maxZoom,
                    minzoom: header.minZoom,
                    vectorLayerIds
                }
            }
        };
    }
}
