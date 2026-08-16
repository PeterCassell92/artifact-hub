import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = fileURLToPath(new URL(".", import.meta.url));

// Bundles our own src/* into a single ESM file so relative imports can be extensionless
// (moduleResolution: "Bundler" in tsconfig.json) while still satisfying Node's ESM loader at
// runtime, which requires fully-specified paths. node_modules stay external — bundling
// @prisma/client (native query-engine binary) or express would be wasteful/fragile.
//
// `alias` mirrors the `#`-prefixed subpath imports in package.json's "imports" field (used for
// key files to avoid long `../../../` chains — see e.g. src/adapters/mcp/tests/support.ts).
// esbuild's own package.json "imports"-field support is unreliable together with
// `packages: "external"` (it can leave `#specifier` unresolved in the bundle, which Node then
// can't load at runtime since the target is a .ts source file). An explicit `alias` map sidesteps
// that: esbuild resolves and inlines these before the external-package check ever runs.
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  packages: "external",
  alias: {
    "#env": `${here}src/env.ts`,
    "#mcp-server": `${here}src/adapters/mcp/server.ts`,
  },
});
