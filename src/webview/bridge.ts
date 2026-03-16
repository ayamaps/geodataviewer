export interface ViewerRuntimeState {
  currentSourceUri: string;
  mapboxToken: string;
  mapStyle: string;
}

export interface VsCodeApi {
  postMessage(message: unknown): void;
  setState(state: unknown): void;
}

export function createBridge(vscode: VsCodeApi, runtimeState: ViewerRuntimeState) {
  function postLog(data: unknown) {
    vscode.postMessage({ command: "log", data });
  }

  function postError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.postMessage({ command: "error", error: message });
  }

  function persistWebviewState() {
    vscode.setState({
      uri: runtimeState.currentSourceUri,
      mapboxToken: runtimeState.mapboxToken,
      mapStyle: runtimeState.mapStyle,
    });
  }

  function wireToolbar() {
    const openFileButton = document.getElementById("toolbar-open-file");
    const openSourceButton = document.getElementById("toolbar-open-source");
    const refreshButton = document.getElementById("toolbar-refresh");
    const galleryButton = document.getElementById("toolbar-gallery");
    const openUrlButton = document.getElementById("toolbar-open-url");
    const urlInput = document.getElementById("toolbar-url-input") as HTMLInputElement | null;

    function loadFromInput() {
      const value = String(urlInput?.value || "").trim();
      if (!value) {
        return;
      }
      vscode.postMessage({
        command: "loadView",
        viewName: "map.view",
        uri: value,
      });
    }

    openFileButton?.addEventListener("click", () => {
      vscode.postMessage({ command: "openGeoDataFile" });
    });

    openSourceButton?.addEventListener("click", () => {
      vscode.postMessage({ command: "openFile" });
    });

    refreshButton?.addEventListener("click", () => {
      vscode.postMessage({ command: "refresh" });
    });

    galleryButton?.addEventListener("click", () => {
      vscode.postMessage({ command: "showMapGallery" });
    });

    openUrlButton?.addEventListener("click", loadFromInput);

    urlInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        loadFromInput();
      }
    });
  }

  return {
    persistWebviewState,
    postError,
    postLog,
    wireToolbar,
  };
}
