import * as fs from 'fs/promises';
import { BaseAdapter, ParsedForKepler } from './baseAdapter';

export class IGCAdapter extends BaseAdapter {
    readonly id = 'igc';
    readonly supportedExtensions = ['.igc'];

    async parse(fileUri: { fsPath: string }): Promise<ParsedForKepler> {
        const content = await fs.readFile(fileUri.fsPath, 'utf-8');
        const points = this.extractTrackPoints(content);
        const features = points.length > 0
            ? [{
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: points
                },
                properties: {
                    source: 'IGC'
                }
            }]
            : [];
        const featureCollection = {
            type: 'FeatureCollection',
            features
        };

        return {
            kind: 'geojson',
            data: featureCollection,
            meta: {
                featureCount: features.length,
                geometryType: features.length > 0 ? 'LineString' : undefined,
                bbox: this.calculateBBox(features)
            }
        };
    }

    private extractTrackPoints(content: string): number[][] {
        const lines = content.split(/\r?\n/);
        const points: number[][] = [];

        for (const line of lines) {
            if (!line.startsWith('B') || line.length < 24) continue;
            const latRaw = line.slice(7, 14);
            const latHemisphere = line[14];
            const lonRaw = line.slice(15, 23);
            const lonHemisphere = line[23];
            const lat = this.convertIGCCoordinate(latRaw, latHemisphere, true);
            const lon = this.convertIGCCoordinate(lonRaw, lonHemisphere, false);
            if (lat !== null && lon !== null) {
                points.push([lon, lat]);
            }
        }

        return points;
    }

    private convertIGCCoordinate(raw: string, hemisphere: string, isLat: boolean): number | null {
        const degreeLength = isLat ? 2 : 3;
        const minuteLength = 2;
        const thousandLength = 3;
        if (raw.length !== degreeLength + minuteLength + thousandLength) {
            return null;
        }
        const degrees = Number(raw.slice(0, degreeLength));
        const minutes = Number(raw.slice(degreeLength, degreeLength + minuteLength));
        const thousand = Number(raw.slice(degreeLength + minuteLength));
        if ([degrees, minutes, thousand].some(Number.isNaN)) {
            return null;
        }
        const decimal = degrees + (minutes + thousand / 1000) / 60;
        const negative = hemisphere === 'S' || hemisphere === 'W';
        return negative ? -decimal : decimal;
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
}
