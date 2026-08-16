import { build } from "esbuild";

// Bundles our own src/* into a single ESM file so relative imports can be extensionless
// (moduleResolution: "Bundler" in tsconfig.json) while still satisfying Node's ESM loader at
// runtime, which requires fully-specified paths. node_modules stay external — bundling
// @prisma/client (native query-engine binary) or express would be wasteful/fragile.
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  packages: "external",
});
