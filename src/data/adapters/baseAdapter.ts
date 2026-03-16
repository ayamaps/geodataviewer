export interface ParsedForKepler {
    kind: 'geojson' | 'table' | 'kepler';
    data?: any;
    fields?: any[];
    rows?: any[];
    meta?: {
        featureCount?: number;
        geometryType?: string;
        bbox?: [number, number, number, number];
        coordinateFields?: string[];
        [key: string]: any;
    };
}

export abstract class BaseAdapter {
    abstract readonly id: string;
    abstract readonly supportedExtensions: string[];

    canHandle(fileName: string): boolean {
        const fileNameLower = fileName.toLowerCase();
        return this.supportedExtensions.some(ext => fileNameLower.endsWith(ext));
    }

    abstract parse(fileUri: any): Promise<ParsedForKepler>;

    protected extractFileExtension(fileName: string): string {
        const parts = fileName.toLowerCase().split('.');
        return parts.length > 1 ? '.' + parts[parts.length - 1] : '';
    }

    protected validateGeoJSON(data: any): boolean {
        if (!data) return false;
        if (data.type === 'FeatureCollection' && Array.isArray(data.features)) return true;
        if (data.type === 'Feature' && data.geometry && data.properties) return true;
        return false;
    }
}
