import * as fs from 'fs/promises';
import * as topojson from 'topojson-client';
import { BaseAdapter, ParsedForKepler } from './baseAdapter';

export class TopoJSONAdapter extends BaseAdapter {
    readonly id = 'topojson';
    readonly supportedExtensions = ['.topojson', '.topo.json'];

    async parse(fileUri: { fsPath: string }): Promise<ParsedForKepler> {
        const content = await fs.readFile(fileUri.fsPath, 'utf-8');
        
        try {
            const topoData = JSON.parse(content);
            
            if (!topoData.type || topoData.type !== 'Topology') {
                throw new Error('Invalid TopoJSON format: missing Topology type');
            }

            if (!topoData.objects) {
                throw new Error('Invalid TopoJSON format: missing objects');
            }

            // Convert first object to GeoJSON
            const objectNames = Object.keys(topoData.objects);
            if (objectNames.length === 0) {
                throw new Error('No objects found in TopoJSON');
            }

            const firstObjectName = objectNames[0];
            const geoJsonData = topojson.feature(topoData, topoData.objects[firstObjectName]);
            
            // Handle different GeoJSON types
            const geoJsonDataTyped = geoJsonData as any;
            if (geoJsonDataTyped.type === 'FeatureCollection') {
                return this.parseFeatureCollection(geoJsonDataTyped, firstObjectName);
            } else if (geoJsonDataTyped.type === 'Feature') {
                // Convert single feature to FeatureCollection
                const featureCollection = {
                    type: 'FeatureCollection',
                    features: [geoJsonDataTyped]
                };
                return this.parseFeatureCollection(featureCollection, firstObjectName);
            } else {
                throw new Error('Unsupported TopoJSON object type');
            }

        } catch (error) {
            throw new Error(`Failed to parse TopoJSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private parseFeatureCollection(data: any, objectName: string): ParsedForKepler {
        const featureCount = data.features?.length || 0;
        const bbox = this.calculateBBox(data.features);
        const geometryType = this.inferGeometryType(data.features);

        return {
            kind: 'geojson',
            data: data,
            meta: {
                featureCount,
                geometryType,
                bbox,
                topoObject: objectName
            }
        };
    }

    private calculateBBox(features: any[]): [number, number, number, number] | undefined {
        if (!features || features.length === 0) return undefined;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let hasValidGeometry = false;

        for (const feature of features) {
            const geometry = feature.geometry;
            if (!geometry || !geometry.coordinates) continue;

            hasValidGeometry = true;
            const coords = this.extractCoordinates(geometry.coordinates);
            
            for (const [x, y] of coords) {
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }

        return hasValidGeometry ? [minX, minY, maxX, maxY] : undefined;
    }

    private extractCoordinates(coords: any): number[][] {
        if (!Array.isArray(coords)) return [];
        
        // Handle different coordinate structures
        if (coords.length === 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
            return [coords as number[]];
        }
        
        // Recursively extract coordinates from nested arrays
        const result: number[][] = [];
        for (const coord of coords) {
            if (Array.isArray(coord)) {
                result.push(...this.extractCoordinates(coord));
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
