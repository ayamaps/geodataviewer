import * as fs from 'fs/promises';
import * as path from 'path';
import { BaseAdapter, ParsedForKepler } from './baseAdapter';
import { CSVAdapter } from './csvAdapter';

export class XlsxAdapter extends BaseAdapter {
    readonly id = 'xlsx';
    readonly supportedExtensions = ['.xlsx'];

    private readonly csvAdapter = new CSVAdapter();

    async parse(fileUri: { fsPath: string }): Promise<ParsedForKepler> {
        const csvPath = fileUri.fsPath.replace(/\.xlsx$/i, '.csv');
        try {
            await fs.access(csvPath);
            return this.csvAdapter.parse({ fsPath: csvPath });
        } catch {
            throw new Error(`XLSX parsing requires a sibling CSV export. Missing file: ${path.basename(csvPath)}`);
        }
    }
}
