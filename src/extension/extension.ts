import * as vscode from "vscode";
import {
  MapPreviewPanel,
  MapPreviewPanelSerializer,
} from "../webview/mapPreviewPanel";
import { DataParserService } from "../data/dataParserService";
import { Logger } from "../utils/logger";
import {
  COMMAND_IDS,
  MAP_GALLERY_ITEMS,
  resolveMapGalleryTarget,
} from "./vscodeFeatures";

let logger: Logger;

export function activate(context: vscode.ExtensionContext) {
  logger = new Logger("GeoDataViewer");
  logger.info("Geo Data Viewer Fast extension is now active");

  const dataParserService = new DataParserService();
  const serializer = new MapPreviewPanelSerializer(context, dataParserService);

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(
      MapPreviewPanel.viewType,
      serializer,
    ),
  );

  // Register commands
  const openCurrentFileCommand = vscode.commands.registerCommand(
    COMMAND_IDS.openCurrentFile,
    () => {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        vscode.window.showInformationMessage(
          "No active file to preview. Open a geospatial data file first.",
        );
        return;
      }
      MapPreviewPanel.createOrShow(
        context,
        activeEditor.document.uri,
        dataParserService,
      );
    },
  );

  const previewOnMapCommand = vscode.commands.registerCommand(
    COMMAND_IDS.previewOnMap,
    (uri?: vscode.Uri) => {
      const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!targetUri) {
        vscode.window.showInformationMessage(
          "Please select a file to preview.",
        );
        return;
      }
      MapPreviewPanel.createOrShow(context, targetUri, dataParserService);
    },
  );

  const reloadMapCommand = vscode.commands.registerCommand(
    COMMAND_IDS.reloadMap,
    () => {
      MapPreviewPanel.reloadCurrent();
    },
  );

  const openFromUrlCommand = vscode.commands.registerCommand(
    COMMAND_IDS.openFromUrl,
    async () => {
      const input = await vscode.window.showInputBox({
        ignoreFocusOut: true,
        placeHolder: "https://example.com/map.json or data/csv/sample.csv",
        prompt: "Input map data URL or workspace-relative path",
      });

      if (!input || input.trim().length === 0) {
        return;
      }

      await MapPreviewPanel.openFromTarget(
        context,
        input.trim(),
        dataParserService,
        vscode.window.activeTextEditor?.document.uri,
      );
    },
  );

  const mapGalleryCommand = vscode.commands.registerCommand(
    COMMAND_IDS.mapGallery,
    async () => {
      const mapQuickPickItems = MAP_GALLERY_ITEMS.map((item) => ({
        label: `$(preview) ${item.name}`,
        description: item.description,
        detail: item.target,
        target: resolveMapGalleryTarget(item.target),
      }));

      const selectedMap = await vscode.window.showQuickPick(mapQuickPickItems, {
        canPickMany: false,
        title: "Geo Data Viewer Map Gallery",
      });

      if (!selectedMap?.target) {
        return;
      }

      await MapPreviewPanel.openFromTarget(
        context,
        selectedMap.target,
        dataParserService,
        vscode.window.activeTextEditor?.document.uri,
      );
    },
  );

  // Legacy command aliases from RandomFractals/geo-data-viewer.
  const legacyMapViewCommand = vscode.commands.registerCommand(
    COMMAND_IDS.legacyMapView,
    async (uri?: vscode.Uri | string) => {
      if (uri instanceof vscode.Uri) {
        MapPreviewPanel.createOrShow(context, uri, dataParserService);
        return;
      }
      if (typeof uri === "string" && uri.trim().length > 0) {
        await MapPreviewPanel.openFromTarget(
          context,
          uri.trim(),
          dataParserService,
        );
        return;
      }
      await vscode.commands.executeCommand(COMMAND_IDS.openCurrentFile);
    },
  );

  const legacyMapViewUrlCommand = vscode.commands.registerCommand(
    COMMAND_IDS.legacyMapViewFromUrl,
    async () => {
      await vscode.commands.executeCommand(COMMAND_IDS.openFromUrl);
    },
  );

  const legacyMapGalleryCommand = vscode.commands.registerCommand(
    COMMAND_IDS.legacyMapGallery,
    async () => {
      await vscode.commands.executeCommand(COMMAND_IDS.mapGallery);
    },
  );

  // Add to subscriptions
  context.subscriptions.push(
    openCurrentFileCommand,
    previewOnMapCommand,
    reloadMapCommand,
    openFromUrlCommand,
    mapGalleryCommand,
    legacyMapViewCommand,
    legacyMapViewUrlCommand,
    legacyMapGalleryCommand,
  );

  // Handle file changes for auto-reload
  const fileChangeWatcher = vscode.workspace.onDidSaveTextDocument(
    (document) => {
      if (MapPreviewPanel.isSupportedFile(document.uri.fsPath)) {
        MapPreviewPanel.refreshForFile(document.uri);
      }
    },
  );

  const configurationWatcher = vscode.workspace.onDidChangeConfiguration(
    (event) => {
      if (event.affectsConfiguration("geoDataViewer")) {
        MapPreviewPanel.reconfigureAll();
      }
    },
  );

  context.subscriptions.push(fileChangeWatcher, configurationWatcher);
}

export function deactivate() {
  logger?.info("Geo Data Viewer Fast extension is now deactivated");
}
