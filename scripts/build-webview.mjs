import { copyFile, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "media", "dist");
const vendorOutDir = path.join(outDir, "vendor");
const outfile = path.join(outDir, "webview.js");

await mkdir(outDir, { recursive: true });
await mkdir(vendorOutDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(repoRoot, "src", "webview", "app.ts")],
  outfile,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  mainFields: ["browser", "module", "main"],
  sourcemap: false,
  minify: true,
  legalComments: "none",
  define: {
    "process.env.NODE_ENV": '"production"',
    global: "globalThis",
  },
  loader: {
    ".json": "json",
  },
});

const keplerPackageDir = await realpath(
  path.join(repoRoot, "node_modules", "kepler.gl"),
);
const vendorAssets = [
  ["node_modules/react/umd/react.production.min.js", "react.production.min.js"],
  [
    "node_modules/react-dom/umd/react-dom.production.min.js",
    "react-dom.production.min.js",
  ],
  ["node_modules/redux/dist/redux.min.js", "redux.min.js"],
  ["node_modules/react-redux/dist/react-redux.min.js", "react-redux.min.js"],
  [
    "node_modules/styled-components/dist/styled-components.min.js",
    "styled-components.min.js",
  ],
  [path.join(keplerPackageDir, "umd", "keplergl.min.js"), "keplergl.min.js"],
];

await Promise.all(
  vendorAssets.map(async ([sourcePath, fileName]) => {
    const absoluteSource = path.isAbsolute(sourcePath)
      ? sourcePath
      : path.join(repoRoot, sourcePath);
    await copyFile(absoluteSource, path.join(vendorOutDir, fileName));
  }),
);

console.log(`Bundled webview to ${outfile}`);
