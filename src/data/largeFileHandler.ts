import * as vscode from "vscode";
import * as fs from "fs/promises";
import { ParsedForKepler } from "./adapters/baseAdapter";

export class LargeFileHandler {
  private static readonly FILE_SIZE_THRESHOLDS = {
    SMALL: 20 * 1024 * 1024, // 20MB
    MEDIUM: 100 * 1024 * 1024, // 100MB
    LARGE: 500 * 1024 * 1024, // 500MB
  };

  private static readonly PREVIEW_LIMITS = {
    SMALL: 10000, // 10k features
    MEDIUM: 5000, // 5k features
    LARGE: 1000, // 1k features
  };

  static async shouldUsePreviewMode(
    fileUri: vscode.Uri,
  ): Promise<{ usePreview: boolean; limit?: number; fileSize: number }> {
    try {
      const stats = await fs.stat(fileUri.fsPath);
      const fileSize = stats.size;

      if (fileSize < this.FILE_SIZE_THRESHOLDS.SMALL) {
        return { usePreview: false, fileSize };
      }

      let limit: number;
      if (fileSize >= this.FILE_SIZE_THRESHOLDS.LARGE) {
        limit = this.PREVIEW_LIMITS.LARGE;
      } else if (fileSize >= this.FILE_SIZE_THRESHOLDS.MEDIUM) {
        limit = this.PREVIEW_LIMITS.MEDIUM;
      } else {
        limit = this.PREVIEW_LIMITS.SMALL;
      }

      return { usePreview: true, limit, fileSize };
    } catch (error) {
      // If we can't determine file size, use conservative approach
      return {
        usePreview: true,
        limit: this.PREVIEW_LIMITS.LARGE,
        fileSize: 0,
      };
    }
  }

  static async showPreviewWarning(
    fileName: string,
    fileSize: number,
    limit: number,
  ): Promise<boolean> {
    const sizeMB = (fileSize / (1024 * 1024)).toFixed(1);
    const message =
      `File "${fileName}" is large (${sizeMB} MB). ` +
      `Opening in preview mode with first ${limit} features for performance. ` +
      `Do you want to continue?`;

    const choice = await vscode.window.showWarningMessage(
      message,
      "Continue with Preview",
      "Cancel",
    );

    return choice === "Continue with Preview";
  }

  static sampleGeoJSON(data: any, limit: number): any {
    if (!data || !data.features) return data;

    const features = data.features.slice(0, limit);

    return {
      ...data,
      features: features,
      meta: {
        ...data.meta,
        originalFeatureCount: data.features.length,
        sampledFeatureCount: features.length,
        isPreview: true,
      },
    };
  }

  static sampleTableData(data: any, limit: number): any {
    if (!data || !data.rows) return data;

    const rows = data.rows.slice(0, limit);

    return {
      ...data,
      rows: rows,
      meta: {
        ...data.meta,
        originalRowCount: data.rows.length,
        sampledRowCount: rows.length,
        isPreview: true,
      },
    };
  }
}
