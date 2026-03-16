import { createHash } from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { ParsedForKepler } from "../data/adapters/baseAdapter";
import { DataParserService } from "../data/dataParserService";
import { COMMAND_IDS, OPEN_FILE_FILTERS } from "../extension/vscodeFeatures";
import { Logger } from "../utils/logger";

interface PanelWebviewState {
  uri: string;
  sourceUri?: string;
  mapStyle: string;
  mapboxToken: string;
}

export class MapPreviewPanelSerializer
  implements vscode.WebviewPanelSerializer
{
  private readonly logger = new Logger("MapPreviewPanelSerializer");

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly dataParserService: DataParserService,
  ) {}

  async deserializeWebviewPanel(
    webviewPanel: vscode.WebviewPanel,
    state: any,
  ): Promise<void> {
    const panelState = state as Partial<PanelWebviewState> | undefined;
    if (!panelState?.uri) {
      this.logger.warn(
        "Missing webview state during restore, closing orphaned panel",
      );
      webviewPanel.dispose();
      return;
    }

    try {
      const sourceUri = panelState.sourceUri
        ? vscode.Uri.parse(panelState.sourceUri)
        : vscode.Uri.parse(panelState.uri);
      const fallbackFileUri = vscode.Uri.parse(panelState.uri);
      const fileUri = await MapPreviewPanel.materializePreviewUri(
        this.context,
        sourceUri,
        fallbackFileUri,
      );
      MapPreviewPanel.revive(
        webviewPanel,
        this.context,
        fileUri,
        this.dataParserService,
        sourceUri,
      );
      this.logger.info("Restored map preview panel", panelState.uri);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to restore webview panel", message);
      vscode.window.showErrorMessage(
        `Failed to restore map preview panel: ${message}`,
      );
      webviewPanel.dispose();
    }
  }
}

export class MapPreviewPanel {
  public static readonly viewType = "GeoDataViewer.mapPreview";
  public static currentPanel: MapPreviewPanel | undefined;
  private static panelsByUri = new Map<string, MapPreviewPanel>();
  private static readonly schemePattern = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
  private static readonly remotePreviewDirName = "remote-previews";

  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private readonly dataParserService: DataParserService;
  private readonly logger = new Logger("MapPreviewPanel");
  private readonly panelKey: string;
  private disposables: vscode.Disposable[] = [];
  private currentData: ParsedForKepler | undefined;
  private fileUri: vscode.Uri;
  private sourceUri: vscode.Uri;
  private isWebviewReady = false;
  private isDisposed = false;

  public static createOrShow(
    context: vscode.ExtensionContext,
    fileUri: vscode.Uri,
    dataParserService: DataParserService,
    sourceUri: vscode.Uri = fileUri,
  ): void {
    const panelKey = MapPreviewPanel.toPanelKey(sourceUri);
    const existingPanel = MapPreviewPanel.panelsByUri.get(panelKey);
    const column = MapPreviewPanel.getActiveViewColumn();
    if (existingPanel) {
      existingPanel.panel.reveal(column);
      MapPreviewPanel.currentPanel = existingPanel;
      void existingPanel.update(fileUri, sourceUri);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      MapPreviewPanel.viewType,
      MapPreviewPanel.toPanelTitle(sourceUri),
      column,
      MapPreviewPanel.createPanelOptions(context, fileUri),
    );

    MapPreviewPanel.revive(
      panel,
      context,
      fileUri,
      dataParserService,
      sourceUri,
    );
  }

  public static revive(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    fileUri: vscode.Uri,
    dataParserService: DataParserService,
    sourceUri: vscode.Uri = fileUri,
  ): void {
    const previewPanel = new MapPreviewPanel(
      panel,
      context,
      fileUri,
      sourceUri,
      dataParserService,
    );
    MapPreviewPanel.panelsByUri.set(
      MapPreviewPanel.toPanelKey(sourceUri),
      previewPanel,
    );
    MapPreviewPanel.currentPanel = previewPanel;
    void previewPanel.update(fileUri, sourceUri);
  }

  public static reloadCurrent(): void {
    MapPreviewPanel.currentPanel?.reload();
  }

  public static refreshForFile(fileUri: vscode.Uri): void {
    const panel = MapPreviewPanel.panelsByUri.get(
      MapPreviewPanel.toPanelKey(fileUri),
    );
    panel?.reload();
  }

  public static reconfigureAll(): void {
    for (const panel of MapPreviewPanel.panelsByUri.values()) {
      panel.reconfigure();
    }
  }

  public static isSupportedFile(filePath: string): boolean {
    return DataParserService.isSupportedFile(filePath);
  }

  public static async openFromTarget(
    context: vscode.ExtensionContext,
    target: string,
    dataParserService: DataParserService,
    baseUri?: vscode.Uri,
  ): Promise<void> {
    const resolvedUri = await MapPreviewPanel.resolveTargetUri(target, baseUri);
    if (!resolvedUri) {
      vscode.window.showErrorMessage(
        `Could not resolve path or URL: ${target}`,
      );
      return;
    }

    if (MapPreviewPanel.isRemoteUri(resolvedUri)) {
      if (!MapPreviewPanel.isSupportedRemoteUri(resolvedUri)) {
        await vscode.commands.executeCommand("vscode.open", resolvedUri);
        vscode.window.showInformationMessage(
          "Remote URL opened in editor because this URL is not a supported geo data format.",
        );
        return;
      }

      try {
        const cachedUri = await MapPreviewPanel.materializePreviewUri(
          context,
          resolvedUri,
        );
        MapPreviewPanel.createOrShow(
          context,
          cachedUri,
          dataParserService,
          resolvedUri,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(
          `Failed to load remote geo data: ${message}`,
        );
      }
      return;
    }

    MapPreviewPanel.createOrShow(context, resolvedUri, dataParserService);
  }

  public static async showOpenGeoDataDialog(
    context: vscode.ExtensionContext,
    dataParserService: DataParserService,
    baseUri?: vscode.Uri,
  ): Promise<void> {
    const selectedFiles = await vscode.window.showOpenDialog({
      defaultUri: MapPreviewPanel.getOpenDialogDefaultUri(baseUri),
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: OPEN_FILE_FILTERS,
    });

    if (!selectedFiles || selectedFiles.length === 0) {
      return;
    }

    MapPreviewPanel.createOrShow(context, selectedFiles[0], dataParserService);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    fileUri: vscode.Uri,
    sourceUri: vscode.Uri,
    dataParserService: DataParserService,
  ) {
    this.panel = panel;
    this.context = context;
    this.fileUri = fileUri;
    this.sourceUri = sourceUri;
    this.dataParserService = dataParserService;
    this.panelKey = MapPreviewPanel.toPanelKey(sourceUri);

    this.panel.webview.options = MapPreviewPanel.createWebviewOptions(
      this.context,
      this.fileUri,
    );
    this.panel.iconPath = vscode.Uri.joinPath(
      this.context.extensionUri,
      "resources",
      "map.svg",
    );
    this.panel.title = MapPreviewPanel.toPanelTitle(this.sourceUri);
    this.panel.webview.html = this.getWebviewContent();

    this.panel.onDidDispose(
      () => this.onPanelDisposed(),
      null,
      this.disposables,
    );
    this.panel.onDidChangeViewState(
      (event) => {
        if (event.webviewPanel.active) {
          MapPreviewPanel.currentPanel = this;
        }
      },
      null,
      this.disposables,
    );

    this.panel.webview.onDidReceiveMessage(
      (message: {
        command?: string;
        data?: any;
        error?: string;
        viewName?: string;
        uri?: string;
      }) => {
        switch (message.command) {
          case "ready":
            this.logger.info("Webview ready, sending data");
            this.isWebviewReady = true;
            this.sendDataToWebview();
            break;
          case "error":
            this.logger.error(
              "Webview error",
              message.error ?? "Unknown webview error",
            );
            vscode.window.showErrorMessage(
              `Map preview error: ${message.error ?? "Unknown error"}`,
            );
            break;
          case "log":
            this.logger.info("Webview log", message.data);
            break;
          case "refresh":
            this.reload();
            break;
          case "openFile":
            void this.openSourceFile();
            break;
          case "openGeoDataFile":
            void MapPreviewPanel.showOpenGeoDataDialog(
              this.context,
              this.dataParserService,
              this.fileUri,
            );
            break;
          case "showMapGallery":
            void vscode.commands.executeCommand(COMMAND_IDS.mapGallery);
            break;
          case "loadView":
            void this.loadView(message.viewName, message.uri);
            break;
          default:
            break;
        }
      },
      null,
      this.disposables,
    );
  }

  private async update(
    fileUri: vscode.Uri,
    sourceUri: vscode.Uri = this.sourceUri,
  ): Promise<void> {
    this.fileUri = fileUri;
    this.sourceUri = sourceUri;
    this.panel.title = `Geo Data: ${this.getDisplayName(sourceUri)}`;

    try {
      this.panel.title = `Loading ${this.getDisplayName(sourceUri)}...`;
      this.currentData = await this.dataParserService.parseFile(fileUri);
      this.panel.title = `Geo Data: ${this.getDisplayName(sourceUri)}`;
      if (this.isWebviewReady) {
        this.sendDataToWebview();
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Failed to parse file", errorMessage);
      void this.panel.webview.postMessage({
        command: "error",
        error: errorMessage,
      });
      vscode.window.showErrorMessage(`Failed to parse file: ${errorMessage}`);
      this.panel.title = `Geo Data: ${this.getDisplayName(sourceUri)}`;
    }
  }

  private sendDataToWebview(): void {
    if (!this.currentData || !this.isWebviewReady) {
      return;
    }

    const settings = this.getViewerSettings();
    const payload =
      this.currentData.kind === "table"
        ? {
            rows: this.currentData.rows,
            fields: this.currentData.fields,
          }
        : this.currentData.data;

    this.logger.info("Sending data to webview", {
      kind: this.currentData.kind,
      featureCount: this.currentData.meta?.featureCount,
    });

    void this.panel.webview.postMessage({
      command: "loadData",
      data: payload,
      meta: this.currentData.meta,
      kind: this.currentData.kind,
      sourceUri: this.sourceUri.toString(true),
      mapStyle: settings.mapStyle,
      mapboxToken: settings.mapboxToken,
    });
  }

  private reload(): void {
    void this.reloadFromSource();
  }

  private async reloadFromSource(): Promise<void> {
    this.logger.info("Reloading map data", this.sourceUri.toString(true));

    try {
      const nextFileUri = await MapPreviewPanel.materializePreviewUri(
        this.context,
        this.sourceUri,
        this.fileUri,
      );
      this.dataParserService.invalidateCache(this.fileUri);
      if (nextFileUri.toString(true) !== this.fileUri.toString(true)) {
        this.dataParserService.invalidateCache(nextFileUri);
      }
      await this.update(nextFileUri, this.sourceUri);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to reload map data", message);
      vscode.window.showErrorMessage(`Failed to reload map data: ${message}`);
    }
  }

  private reconfigure(): void {
    if (this.isDisposed) {
      return;
    }
    this.isWebviewReady = false;
    this.panel.webview.options = MapPreviewPanel.createWebviewOptions(
      this.context,
      this.fileUri,
    );
    this.panel.webview.html = this.getWebviewContent();
  }

  public dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.cleanup();
    this.panel.dispose();
  }

  private onPanelDisposed(): void {
    if (this.isDisposed) {
      return;
    }
    this.cleanup();
  }

  private cleanup(): void {
    this.isDisposed = true;
    MapPreviewPanel.panelsByUri.delete(this.panelKey);
    if (MapPreviewPanel.currentPanel === this) {
      MapPreviewPanel.currentPanel = undefined;
    }

    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      disposable?.dispose();
    }
  }

  private async openSourceFile(): Promise<void> {
    const sourceUri = this.sourceUri;
    try {
      if (sourceUri.scheme === "file") {
        const document = await vscode.workspace.openTextDocument(sourceUri);
        await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
        return;
      }
      await vscode.commands.executeCommand("vscode.open", sourceUri);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to open source file", message);
      vscode.window.showErrorMessage(`Failed to open source: ${message}`);
    }
  }

  private async loadView(viewName?: string, rawUri?: string): Promise<void> {
    if (!viewName || !rawUri) {
      return;
    }

    const command = MapPreviewPanel.normalizeMapCommand(viewName);

    if (MapPreviewPanel.isMapPreviewCommand(command)) {
      await MapPreviewPanel.openFromTarget(
        this.context,
        rawUri,
        this.dataParserService,
        this.sourceUri,
      );
      return;
    }

    const targetUri = await MapPreviewPanel.resolveTargetUri(
      rawUri,
      this.fileUri,
    );
    if (!targetUri) {
      vscode.window.showErrorMessage(`Could not resolve '${rawUri}'`);
      return;
    }

    await vscode.commands.executeCommand(command, targetUri);
  }

  private static normalizeMapCommand(viewName: string): string {
    if (viewName === COMMAND_IDS.legacyMapView) {
      return COMMAND_IDS.previewOnMap;
    }
    return viewName;
  }

  private static isMapPreviewCommand(command: string): boolean {
    return command === COMMAND_IDS.previewOnMap;
  }

  private getDisplayName(fileUri: vscode.Uri): string {
    if (fileUri.scheme === "file") {
      return path.basename(fileUri.fsPath);
    }
    const pathName = fileUri.path.split("/").filter(Boolean).pop();
    return pathName ?? fileUri.toString(true);
  }

  private getViewerSettings(): { mapStyle: string; mapboxToken: string } {
    const config = vscode.workspace.getConfiguration("geoDataViewer");
    return {
      mapStyle: config.get<string>("mapStyle", "positron"),
      mapboxToken: config.get<string>("mapboxToken", ""),
    };
  }

  private getWebviewContent(): string {
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "dist",
        "webview.js",
      ),
    );
    const reactScriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "dist",
        "vendor",
        "react.production.min.js",
      ),
    );
    const reactDomScriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "dist",
        "vendor",
        "react-dom.production.min.js",
      ),
    );
    const reduxScriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "dist",
        "vendor",
        "redux.min.js",
      ),
    );
    const reactReduxScriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "dist",
        "vendor",
        "react-redux.min.js",
      ),
    );
    const styledComponentsScriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "dist",
        "vendor",
        "styled-components.min.js",
      ),
    );
    const keplerScriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "dist",
        "vendor",
        "keplergl.min.js",
      ),
    );
    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "main.css"),
    );
    const superfineCssUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "vendor",
        "superfine.css",
      ),
    );
    const mapboxCssUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "vendor",
        "mapbox-gl.css",
      ),
    );
    const maplibreCssUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "vendor",
        "maplibre-gl.css",
      ),
    );
    const styleSupportScriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "styleSupport.js",
      ),
    );
    const cspSource = this.panel.webview.cspSource;
    const settings = this.getViewerSettings();
    const serializedState = JSON.stringify({
      uri: this.fileUri.toString(true),
      sourceUri: this.sourceUri.toString(true),
      mapStyle: settings.mapStyle,
      mapboxToken: settings.mapboxToken,
    } as PanelWebviewState);

    return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy"
                    content="default-src 'self' ${cspSource} https:;
                        script-src ${cspSource} https: 'unsafe-inline' 'unsafe-eval';
                        style-src ${cspSource} https: 'unsafe-inline';
                        img-src ${cspSource} https: data: blob:;
                        font-src ${cspSource} https: data: blob:;
                        connect-src ${cspSource} https: http: wss:;
                        worker-src ${cspSource} https: blob: data:;">
                <title>Geo Data Viewer</title>
                <link rel="stylesheet" href="${superfineCssUri}">
                <link href="${mapboxCssUri}" rel="stylesheet" />
                <link href="${maplibreCssUri}" rel="stylesheet" />
                <link href="${styleUri}" rel="stylesheet">
            </head>
            <body>
                <div id="toolbar">
                    <div id="toolbar-left">
                        <button id="toolbar-open-file" class="toolbar-button" title="Open Geo Data File">Open</button>
                        <input id="toolbar-url-input" type="text" placeholder="Path or URL" title="Load map view from file path or URL" />
                        <button id="toolbar-open-url" class="toolbar-button" title="Load from path or URL">Go</button>
                        <button id="toolbar-gallery" class="toolbar-button" title="Open Map Gallery">Gallery</button>
                    </div>
                    <div id="toolbar-right">
                        <button id="toolbar-open-source" class="toolbar-button" title="Open source file">Source</button>
                        <button id="toolbar-refresh" class="toolbar-button" title="Refresh map">Refresh</button>
                    </div>
                </div>
                <div id="map">
                    <div class="loading">Loading Kepler.gl...</div>
                </div>
                <script>window.__GEO_DATA_VIEWER_STATE__ = ${serializedState};</script>
                <script src="${reactScriptUri}"></script>
                <script src="${reactDomScriptUri}"></script>
                <script src="${reduxScriptUri}"></script>
                <script src="${reactReduxScriptUri}"></script>
                <script src="${styledComponentsScriptUri}"></script>
                <script src="${keplerScriptUri}"></script>
                <script src="${styleSupportScriptUri}"></script>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
  }

  private static createWebviewOptions(
    context: vscode.ExtensionContext,
    fileUri: vscode.Uri,
  ): vscode.WebviewOptions {
    return {
      enableScripts: true,
      enableCommandUris: true,
      localResourceRoots: MapPreviewPanel.getLocalResourceRoots(
        context,
        fileUri,
      ),
    };
  }

  private static createPanelOptions(
    context: vscode.ExtensionContext,
    fileUri: vscode.Uri,
  ): vscode.WebviewOptions & vscode.WebviewPanelOptions {
    return {
      ...MapPreviewPanel.createWebviewOptions(context, fileUri),
      retainContextWhenHidden: true,
    };
  }

  private static getLocalResourceRoots(
    context: vscode.ExtensionContext,
    fileUri: vscode.Uri,
  ): vscode.Uri[] {
    const roots: vscode.Uri[] = [
      vscode.Uri.joinPath(context.extensionUri, "media"),
    ];
    if (fileUri.scheme === "file") {
      roots.push(vscode.Uri.file(path.dirname(fileUri.fsPath)));
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
    if (workspaceFolder) {
      roots.push(workspaceFolder.uri);
    } else if (
      vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
    ) {
      roots.push(vscode.workspace.workspaceFolders[0].uri);
    }

    const dedup = new Map<string, vscode.Uri>();
    for (const root of roots) {
      dedup.set(root.toString(true), root);
    }
    return Array.from(dedup.values());
  }

  private static async resolveTargetUri(
    target: string,
    baseUri?: vscode.Uri,
  ): Promise<vscode.Uri | undefined> {
    const trimmed = target.trim();
    if (!trimmed) {
      return undefined;
    }

    if (MapPreviewPanel.schemePattern.test(trimmed)) {
      try {
        return vscode.Uri.parse(trimmed);
      } catch {
        return undefined;
      }
    }

    if (path.isAbsolute(trimmed)) {
      if (await MapPreviewPanel.pathExists(trimmed)) {
        return vscode.Uri.file(trimmed);
      }
      return undefined;
    }

    if (baseUri?.scheme === "file") {
      const siblingPath = path.resolve(path.dirname(baseUri.fsPath), trimmed);
      if (await MapPreviewPanel.pathExists(siblingPath)) {
        return vscode.Uri.file(siblingPath);
      }
    }

    if (
      vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
    ) {
      for (const folder of vscode.workspace.workspaceFolders) {
        const workspacePath = path.resolve(folder.uri.fsPath, trimmed);
        if (await MapPreviewPanel.pathExists(workspacePath)) {
          return vscode.Uri.file(workspacePath);
        }
      }
    }

    const normalizedGlob = `**/${trimmed.replace(/\\/g, "/")}`;
    const matches = await vscode.workspace.findFiles(
      normalizedGlob,
      "**/node_modules/**",
      1,
    );
    if (matches.length > 0) {
      return matches[0];
    }
    return undefined;
  }

  private static async pathExists(fsPath: string): Promise<boolean> {
    return MapPreviewPanel.uriExists(vscode.Uri.file(fsPath));
  }

  private static async uriExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  private static isRemoteUri(uri: vscode.Uri): boolean {
    return uri.scheme === "http" || uri.scheme === "https";
  }

  private static isSupportedRemoteUri(uri: vscode.Uri): boolean {
    return DataParserService.isSupportedFile(uri.path.toLowerCase());
  }

  static async materializePreviewUri(
    context: vscode.ExtensionContext,
    sourceUri: vscode.Uri,
    fallbackFileUri?: vscode.Uri,
  ): Promise<vscode.Uri> {
    if (!MapPreviewPanel.isRemoteUri(sourceUri)) {
      return fallbackFileUri ?? sourceUri;
    }

    try {
      return await MapPreviewPanel.cacheRemoteUri(context, sourceUri);
    } catch (error) {
      if (
        fallbackFileUri &&
        (await MapPreviewPanel.uriExists(fallbackFileUri))
      ) {
        return fallbackFileUri;
      }
      throw error;
    }
  }

  private static async cacheRemoteUri(
    context: vscode.ExtensionContext,
    remoteUri: vscode.Uri,
  ): Promise<vscode.Uri> {
    const response = await fetch(remoteUri.toString(true), {
      headers: {
        Accept: "*/*",
        "User-Agent": "GeoDataViewerFast/0.2.0",
      },
    });

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText} for ${remoteUri.toString(true)}`,
      );
    }

    const remoteHash = createHash("sha1")
      .update(remoteUri.toString(true))
      .digest("hex")
      .slice(0, 12);
    const cacheDir = vscode.Uri.joinPath(
      context.globalStorageUri,
      MapPreviewPanel.remotePreviewDirName,
      remoteHash,
    );
    await vscode.workspace.fs.createDirectory(cacheDir);

    const fileName = MapPreviewPanel.getRemoteFileName(remoteUri);
    const cacheFile = vscode.Uri.joinPath(cacheDir, fileName);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await vscode.workspace.fs.writeFile(cacheFile, bytes);
    return cacheFile;
  }

  private static getRemoteFileName(remoteUri: vscode.Uri): string {
    const rawName =
      path.posix.basename(remoteUri.path) ||
      path.basename(remoteUri.path) ||
      "remote-data";
    return rawName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
  }

  private static getOpenDialogDefaultUri(
    baseUri?: vscode.Uri,
  ): vscode.Uri | undefined {
    if (baseUri?.scheme === "file") {
      return vscode.Uri.file(path.dirname(baseUri.fsPath));
    }

    if (
      vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
    ) {
      return vscode.workspace.workspaceFolders[0].uri;
    }

    return undefined;
  }

  private static getActiveViewColumn(): vscode.ViewColumn {
    return vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
  }

  private static toPanelTitle(fileUri: vscode.Uri): string {
    if (fileUri.scheme === "file") {
      return `Geo Data: ${path.basename(fileUri.fsPath)}`;
    }
    const pathName = fileUri.path.split("/").filter(Boolean).pop();
    return `Geo Data: ${pathName ?? fileUri.toString(true)}`;
  }

  private static toPanelKey(fileUri: vscode.Uri): string {
    return fileUri.toString(true);
  }
}
