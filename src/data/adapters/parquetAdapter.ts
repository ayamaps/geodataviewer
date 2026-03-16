import * as fs from 'fs/promises';
import { parse } from '@loaders.gl/core';
import { GeoParquetLoader, ParquetLoader } from '@loaders.gl/parquet';
import { BaseAdapter, ParsedForKepler } from './baseAdapter';

export class ParquetAdapter extends BaseAdapter {
    readonly id = 'parquet';
    readonly supportedExtensions = ['.parquet', '.geoparquet', '.gpq'];

    async parse(fileUri: { fsPath: string }): Promise<ParsedForKepler> {
        try {
            const input = await fs.readFile(fileUri.fsPath);
            const arrayBuffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
            const loader = fileUri.fsPath.toLowerCase().includes('geo')
                ? GeoParquetLoader
                : ParquetLoader;
            const parsed = await parse(arrayBuffer, loader as any) as any;

            if (parsed?.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
                const features = parsed.features;
                return {
                    kind: 'geojson',
                    data: parsed,
                    meta: {
                        featureCount: features.length,
                        geometryType: this.inferGeometryType(features),
                        bbox: this.calculateBBox(features)
                    }
                };
            }

            const rows = parsed?.data || [];
            const firstRow = rows[0] || {};
            const fields = Object.keys(firstRow).map((name) => ({ name, type: typeof firstRow[name] }));
            return {
                kind: 'table',
                rows,
                fields,
                meta: {
                    featureCount: rows.length
                }
            };
            
        } catch (error) {
            throw new Error(`Failed to parse Parquet: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
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
