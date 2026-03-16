import * as fs from 'fs/promises';
import { parse } from '@loaders.gl/core';
import { CSVLoader } from '@loaders.gl/csv';
import { BaseAdapter, ParsedForKepler } from './baseAdapter';

export class CSVAdapter extends BaseAdapter {
    readonly id = 'csv';
    readonly supportedExtensions = ['.csv', '.tsv'];

    private coordinateFieldPatterns = [
        ['lat', 'latitude'],
        ['lng', 'long', 'longitude'],
        ['lon'],
        ['x', 'y'],
        ['latitud', 'longitud']
    ];

    async parse(fileUri: { fsPath: string }): Promise<ParsedForKepler> {
        const content = await fs.readFile(fileUri.fsPath, 'utf-8');
        
        try {
            const parsedTable = await parse(content, CSVLoader) as { data?: Record<string, unknown>[] };
            const parsed = parsedTable.data || [];

            if (!Array.isArray(parsed) || parsed.length === 0) {
                throw new Error('CSV file must have at least a header and one data row');
            }
            const headers = Object.keys(parsed[0]);
            const coordinateFields = this.detectCoordinateFields(headers);
            
            if (coordinateFields.length === 0) {
                return this.parseAsTable(headers, parsed);
            }

            return this.parseAsGeoJSON(parsed, coordinateFields);

        } catch (error) {
            throw new Error(`Failed to parse CSV: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private detectCoordinateFields(headers: string[]): string[] {
        const foundFields: string[] = [];
        
        for (const [latPattern, lngPattern] of this.coordinateFieldPatterns) {
            const latField = headers.find(h => 
                h.toLowerCase().includes(latPattern)
            );
            const lngField = headers.find(h => 
                h.toLowerCase().includes(lngPattern)
            );
            
            if (latField && lngField) {
                foundFields.push(latField, lngField);
            }
        }
        
        return [...new Set(foundFields)]; // Remove duplicates
    }

    private parseAsTable(headers: string[], rows: Record<string, unknown>[]): ParsedForKepler {
        return {
            kind: 'table',
            fields: headers.map(name => ({ name, type: typeof rows[0]?.[name] })),
            rows: rows,
            meta: {
                featureCount: rows.length,
                coordinateFields: []
            }
        };
    }

    private parseAsGeoJSON(rows: Record<string, unknown>[], coordinateFields: string[]): ParsedForKepler {
        const features = [];
        
        for (const row of rows) {
            const properties: any = {};
            let lat: number | null = null;
            let lng: number | null = null;
            
            Object.keys(row).forEach((header) => {
                const value = row[header];
                
                // Check if this is a coordinate field
                if (coordinateFields.includes(header)) {
                    const numValue = parseFloat(String(value ?? ''));
                    if (!isNaN(numValue)) {
                        // Determine if this is lat or lng based on field name
                        if (header.toLowerCase().includes('lat')) {
                            lat = numValue;
                        } else if (header.toLowerCase().includes('lng') || header.toLowerCase().includes('lon')) {
                            lng = numValue;
                        }
                    }
                } else {
                    properties[header] = value;
                }
            });
            
            // Only create feature if we have valid coordinates
            if (lat !== null && lng !== null) {
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [lng, lat]
                    },
                    properties: properties
                });
            }
        }

        const featureCollection = {
            type: 'FeatureCollection',
            features: features
        };

        return {
            kind: 'geojson',
            data: featureCollection,
            meta: {
                featureCount: features.length,
                geometryType: 'Point',
                coordinateFields,
                bbox: this.calculateBBox(features)
            }
        };
    }

    private calculateBBox(features: any[]): [number, number, number, number] | undefined {
        if (features.length === 0) return undefined;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (const feature of features) {
            const coords = feature.geometry.coordinates;
            if (coords && coords.length >= 2) {
                minX = Math.min(minX, coords[0]);
                minY = Math.min(minY, coords[1]);
                maxX = Math.max(maxX, coords[0]);
                maxY = Math.max(maxY, coords[1]);
            }
        }

        return [minX, minY, maxX, maxY];
    }
}
