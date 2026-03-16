import * as fs from 'fs/promises';
import { parse } from '@loaders.gl/core';
import { FlatGeobufLoader } from '@loaders.gl/flatgeobuf';
import { BaseAdapter, ParsedForKepler } from './baseAdapter';

export class FlatGeobufAdapter extends BaseAdapter {
    readonly id = 'flatgeobuf';
    readonly supportedExtensions = ['.fgb'];

    async parse(fileUri: { fsPath: string }): Promise<ParsedForKepler> {
        try {
            const input = await fs.readFile(fileUri.fsPath);
            const arrayBuffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
            const parsed = await parse(arrayBuffer, FlatGeobufLoader) as any;
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
            
        } catch (error) {
            throw new Error(`Failed to parse FlatGeobuf: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
