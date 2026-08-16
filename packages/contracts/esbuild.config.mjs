import { build } from "esbuild";

// Bundles src/* into a single ESM file so relative imports can be extensionless
// (moduleResolution: "Bundler" in tsconfig.json) while still satisfying Node's ESM loader for
// backend consumers, which require fully-specified paths. `zod` stays external — both consumers
// (backend directly, frontend transitively) already resolve it from their own node_modules.
// Type declarations are emitted separately by tsc (emitDeclarationOnly in tsconfig.json).
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "neutral",
  format: "esm",
  target: "es2022",
  sourcemap: true,
  packages: "external",
});
