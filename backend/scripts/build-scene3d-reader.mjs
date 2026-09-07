import { build } from "esbuild"
import { resolve } from "node:path"

/** One compiled copy of the renderer's source, usable by plain Node in the API worker. */
export async function buildScene3DReader(backendRoot) {
  await build({
    entryPoints: [resolve(backendRoot, "../packages/remotion/src/scene3d/headless.ts")],
    outfile: resolve(backendRoot, "dist/lib/scene3d-reader.mjs"),
    bundle: true, platform: "node", target: "node22", format: "esm",
    packages: "external", sourcemap: true, logLevel: "warning",
  })
}
