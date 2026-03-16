import * as fs from 'fs/promises';
import * as path from 'path';
import { load } from '@loaders.gl/core';
import { ShapefileLoader } from '@loaders.gl/shapefile';
import { BaseAdapter, ParsedForKepler } from './baseAdapter';

export class ShapefileAdapter extends BaseAdapter {
    readonly id = 'shapefile';
    readonly supportedExtensions = ['.shp', '.zip'];

    async parse(fileUri: { fsPath: string }): Promise<ParsedForKepler> {
        try {
            if (fileUri.fsPath.toLowerCase().endsWith('.zip')) {
                return this.parseZipShapefile({ fsPath: fileUri.fsPath });
            }
            return this.parseShapefile({ fsPath: fileUri.fsPath });
        } catch (error) {
            throw new Error(`Failed to parse Shapefile: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async parseZipShapefile(fileUri: { fsPath: string }): Promise<ParsedForKepler> {
        const base = fileUri.fsPath.slice(0, -4);
        const siblingShp = `${base}.shp`;
        try {
            await fs.access(siblingShp);
            return this.parseShapefile({ fsPath: siblingShp });
        } catch {
            throw new Error('ZIP shapefile requires extracted .shp/.dbf/.shx files in the same folder');
        }
    }

    private async parseShapefile(fileUri: { fsPath: string }): Promise<ParsedForKepler> {
        const fetchLocalFile = async (url: string): Promise<Response> => {
            const normalizedPath = path.isAbsolute(url)
                ? url
                : path.join(path.dirname(fileUri.fsPath), url);
            try {
                const content = await fs.readFile(normalizedPath);
                return new Response(content);
            } catch {
                return new Response('', { status: 404 });
            }
        };

        const parsed = await load(fileUri.fsPath, ShapefileLoader as any, {
            fetch: fetchLocalFile,
            shapefile: { shape: 'geojson-table' }
        }) as any;
        const featureCollection = parsed?.type === 'FeatureCollection'
            ? parsed
            : { type: 'FeatureCollection', features: [] };
        const features = featureCollection.features || [];

        return {
            kind: 'geojson',
            data: featureCollection,
            meta: {
                featureCount: features.length,
                geometryType: this.inferGeometryType(features),
                bbox: this.calculateBBox(features)
            }
        };
    }

    private calculateBBox(features: any[]): [number, number, number, number] | undefined {
        if (features.length === 0) return undefined;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let hasValidGeometry = false;

        for (const feature of features) {
            const geometry = feature.geometry;
            if (!geometry || !geometry.coordinates) continue;
            hasValidGeometry = true;
            const coords = this.extractAllCoordinates(geometry.coordinates);
            for (const [x, y] of coords) {
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }
        return hasValidGeometry ? [minX, minY, maxX, maxY] : undefined;
    }

    private extractAllCoordinates(coords: any): number[][] {
        if (!Array.isArray(coords)) return [];
        if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
            return [[coords[0], coords[1]]];
        }
        const result: number[][] = [];
        for (const coord of coords) {
            if (Array.isArray(coord)) {
                result.push(...this.extractAllCoordinates(coord));
            }
        }
        return result;
    }

    private inferGeometryType(features: any[]): string | undefined {
        if (!features || features.length === 0) return undefined;
        const types = new Set(features.map((f: any) => f.geometry?.type).filter(Boolean));
        if (types.size === 1) return Array.from(types)[0] as string;
        if (types.size > 1) return 'Mixed';
        return undefined;
    }
}
