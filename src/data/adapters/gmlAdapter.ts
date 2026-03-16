import * as fs from 'fs/promises';
import { BaseAdapter, ParsedForKepler } from './baseAdapter';

export class GMLAdapter extends BaseAdapter {
    readonly id = 'gml';
    readonly supportedExtensions = ['.gml'];

    async parse(fileUri: { fsPath: string }): Promise<ParsedForKepler> {
        const content = await fs.readFile(fileUri.fsPath, 'utf-8');
        const features = this.extractFeatures(content);
        const featureCollection = {
            type: 'FeatureCollection',
            features
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
    }

    private extractFeatures(xml: string): any[] {
        const posListRegex = /<gml:posList[^>]*>([\s\S]*?)<\/gml:posList>/gi;
        const features: any[] = [];
        let match: RegExpExecArray | null;
        while ((match = posListRegex.exec(xml)) !== null) {
            const coords = this.parsePosList(match[1]);
            if (coords.length >= 3) {
                const ring = this.closeRing(coords);
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'Polygon',
                        coordinates: [ring]
                    },
                    properties: {}
                });
            }
        }

        const coordinatesRegex = /<gml:coordinates[^>]*>([\s\S]*?)<\/gml:coordinates>/gi;
        while ((match = coordinatesRegex.exec(xml)) !== null) {
            const coords = this.parseCoordinates(match[1]);
            if (coords.length >= 3) {
                const ring = this.closeRing(coords);
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'Polygon',
                        coordinates: [ring]
                    },
                    properties: {}
                });
            } else if (coords.length === 1) {
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: coords[0]
                    },
                    properties: {}
                });
            } else if (coords.length === 2) {
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: coords
                    },
                    properties: {}
                });
            }
        }

        if (features.length === 0) {
            const posRegex = /<gml:pos[^>]*>([\s\S]*?)<\/gml:pos>/gi;
            const points: number[][] = [];
            while ((match = posRegex.exec(xml)) !== null) {
                const values = match[1].trim().split(/\s+/).map((v) => Number(v));
                if (values.length >= 2 && !Number.isNaN(values[0]) && !Number.isNaN(values[1])) {
                    points.push([values[0], values[1]]);
                }
            }
            if (points.length > 0) {
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: points.length === 1 ? 'Point' : 'LineString',
                        coordinates: points.length === 1 ? points[0] : points
                    },
                    properties: {}
                });
            }
        }

        return features;
    }

    private parsePosList(text: string): number[][] {
        const values = text.trim().split(/\s+/).map((v) => Number(v));
        const coords: number[][] = [];
        for (let i = 0; i < values.length - 1; i += 2) {
            const x = values[i];
            const y = values[i + 1];
            if (!Number.isNaN(x) && !Number.isNaN(y)) {
                coords.push([x, y]);
            }
        }
        return coords;
    }

    private parseCoordinates(text: string): number[][] {
        const tokens = text.trim().split(/\s+/);
        const coords: number[][] = [];
        for (const token of tokens) {
            const [xRaw, yRaw] = token.split(',');
            const x = Number(xRaw);
            const y = Number(yRaw);
            if (!Number.isNaN(x) && !Number.isNaN(y)) {
                coords.push([x, y]);
            }
        }
        return coords;
    }

    private closeRing(coords: number[][]): number[][] {
        if (coords.length === 0) return coords;
        const first = coords[0];
        const last = coords[coords.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
            return [...coords, [first[0], first[1]]];
        }
        return coords;
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
