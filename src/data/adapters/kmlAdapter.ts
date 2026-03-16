import * as fs from 'fs/promises';
import { parse } from '@loaders.gl/core';
import { KMLLoader } from '@loaders.gl/kml';
import { BaseAdapter, ParsedForKepler } from './baseAdapter';

export class KMLAdapter extends BaseAdapter {
    readonly id = 'kml';
    readonly supportedExtensions = ['.kml'];

    async parse(fileUri: { fsPath: string }): Promise<ParsedForKepler> {
        const content = await fs.readFile(fileUri.fsPath, 'utf-8');
        
        try {
            const parsed = await parse(content, KMLLoader) as any;
            const normalizedFeatureCollection = parsed?.type === 'FeatureCollection'
                ? parsed
                : { type: 'FeatureCollection', features: [] };
            const features = normalizedFeatureCollection.features || [];
            const featureCollection = {
                type: 'FeatureCollection',
                features: features
            };

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
            throw new Error(`Failed to parse KML: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private calculateBBox(features: any[]): [number, number, number, number] | undefined {
        if (features.length === 0) return undefined;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
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
        
        const types = new Set(features
            .map(f => f.geometry?.type)
            .filter(Boolean)
        );
        
        if (types.size === 1) return Array.from(types)[0];
        if (types.size > 1) return 'Mixed';
        return undefined;
    }
}
