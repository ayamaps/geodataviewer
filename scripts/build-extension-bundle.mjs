import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "dist", "bundle");
const outfile = path.join(outDir, "extension.js");

await mkdir(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(repoRoot, "src", "extension", "extension.ts")],
  outfile,
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  external: ["vscode"],
  legalComments: "none",
  minify: true,
  sourcemap: false,
  tsconfig: path.join(repoRoot, "tsconfig.json"),
});

console.log(`Bundled extension host to ${outfile}`);
