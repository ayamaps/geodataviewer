import * as fs from 'fs/promises';
import { BaseAdapter, ParsedForKepler } from './baseAdapter';

export class WKTAdapter extends BaseAdapter {
    readonly id = 'wkt';
    readonly supportedExtensions = ['.wkt'];

    async parse(fileUri: { fsPath: string }): Promise<ParsedForKepler> {
        const content = await fs.readFile(fileUri.fsPath, 'utf-8');
        
        try {
            const wktStrings = this.extractWKTStrings(content);
            const features = wktStrings.map((wkt, index) => this.parseWKT(wkt, index));
            
            const validFeatures = features.filter(f => f !== null);
            const featureCollection = {
                type: 'FeatureCollection',
                features: validFeatures
            };

            return {
                kind: 'geojson',
                data: featureCollection,
                meta: {
                    featureCount: validFeatures.length,
                    geometryType: this.inferGeometryType(validFeatures),
                    bbox: this.calculateBBox(validFeatures)
                }
            };

        } catch (error) {
            throw new Error(`Failed to parse WKT: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private extractWKTStrings(content: string): string[] {
        const normalized = content.replace(/\r?\n/g, ' ').trim();
        const matches = normalized.match(/(MULTIPOLYGON|MULTILINESTRING|MULTIPOINT|POLYGON|LINESTRING|POINT)\s*\([^;]+?\)(?=\s*(MULTIPOLYGON|MULTILINESTRING|MULTIPOINT|POLYGON|LINESTRING|POINT|$))/gi);
        if (matches && matches.length > 0) {
            return matches.map((m) => m.trim());
        }
        return [normalized].filter(Boolean);
    }

    private parseWKT(wktString: string, index: number): any | null {
        try {
            const upperWKT = wktString.toUpperCase();
            
            if (upperWKT.startsWith('POINT')) {
                return this.parsePoint(wktString, index);
            } else if (upperWKT.startsWith('LINESTRING')) {
                return this.parseLineString(wktString, index);
            } else if (upperWKT.startsWith('POLYGON')) {
                return this.parsePolygon(wktString, index);
            } else if (upperWKT.startsWith('MULTIPOINT')) {
                return this.parseMultiPoint(wktString, index);
            } else if (upperWKT.startsWith('MULTILINESTRING')) {
                return this.parseMultiLineString(wktString, index);
            } else if (upperWKT.startsWith('MULTIPOLYGON')) {
                return this.parseMultiPolygon(wktString, index);
            }
            
            return null;
        } catch (error) {
            console.warn(`Failed to parse WKT: ${wktString}`, error);
            return null;
        }
    }

    private parsePoint(wktString: string, index: number): any {
        const coords = this.extractCoordinates(wktString);
        if (coords.length === 0) return null;

        return {
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: coords[0]
            },
            properties: {
                id: index,
                wkt_type: 'POINT'
            }
        };
    }

    private parseLineString(wktString: string, index: number): any {
        const coords = this.extractCoordinates(wktString);
        if (coords.length < 2) return null;

        return {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: coords
            },
            properties: {
                id: index,
                wkt_type: 'LINESTRING'
            }
        };
    }

    private parsePolygon(wktString: string, index: number): any {
        const rings = this.extractPolygonRings(wktString);
        if (rings.length === 0) return null;

        return {
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: rings
            },
            properties: {
                id: index,
                wkt_type: 'POLYGON'
            }
        };
    }

    private parseMultiPoint(wktString: string, index: number): any {
        const coords = this.extractCoordinates(wktString);
        if (coords.length === 0) return null;

        return {
            type: 'Feature',
            geometry: {
                type: 'MultiPoint',
                coordinates: coords
            },
            properties: {
                id: index,
                wkt_type: 'MULTIPOINT'
            }
        };
    }

    private parseMultiLineString(wktString: string, index: number): any {
        const lineStrings = this.extractMultipleLineStrings(wktString);
        if (lineStrings.length === 0) return null;

        return {
            type: 'Feature',
            geometry: {
                type: 'MultiLineString',
                coordinates: lineStrings
            },
            properties: {
                id: index,
                wkt_type: 'MULTILINESTRING'
            }
        };
    }

    private parseMultiPolygon(wktString: string, index: number): any {
        const polygons = this.extractMultiplePolygons(wktString);
        if (polygons.length === 0) return null;

        return {
            type: 'Feature',
            geometry: {
                type: 'MultiPolygon',
                coordinates: polygons
            },
            properties: {
                id: index,
                wkt_type: 'MULTIPOLYGON'
            }
        };
    }

    private extractCoordinates(wktString: string): number[][] {
        const coords: number[][] = [];
        
        // Extract coordinate pairs
        const coordRegex = /(-?\d+\.?\d*)\s+(-?\d+\.?\d*)/g;
        let match;
        
        while ((match = coordRegex.exec(wktString)) !== null) {
            const x = parseFloat(match[1]);
            const y = parseFloat(match[2]);
            if (!isNaN(x) && !isNaN(y)) {
                coords.push([x, y]);
            }
        }
        
        return coords;
    }

    private extractPolygonRings(wktString: string): number[][][] {
        const rings: number[][][] = [];
        
        // Extract ring coordinates
        const ringRegex = /\(\s*([^)]+)\s*\)/g;
        let match;
        
        while ((match = ringRegex.exec(wktString)) !== null) {
            const ringCoords = this.extractCoordinates(match[1]);
            if (ringCoords.length > 0) {
                rings.push(ringCoords); // GeoJSON polygon rings are arrays
            }
        }
        
        return rings;
    }

    private extractMultipleLineStrings(wktString: string): number[][][] {
        const lineStrings: number[][][] = [];
        
        // Extract individual linestrings
        const lineRegex = /\(\s*([^)]+)\s*\)/g;
        let match;
        
        while ((match = lineRegex.exec(wktString)) !== null) {
            const coords = this.extractCoordinates(match[1]);
            if (coords.length > 0) {
                lineStrings.push(coords);
            }
        }
        
        return lineStrings;
    }

    private extractMultiplePolygons(wktString: string): number[][][][] {
        const polygons: number[][][][] = [];
        
        // This is a simplified implementation - would need more complex parsing for nested polygons
        const polygonRegex = /\(\s*\(\s*([^)]+)\s*\)\s*\)/g;
        let match;
        
        while ((match = polygonRegex.exec(wktString)) !== null) {
            const rings = this.extractPolygonRings('(' + match[1] + ')');
            if (rings.length > 0) {
                polygons.push(rings);
            }
        }
        
        return polygons;
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
