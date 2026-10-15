// tools/structure/project-scan.mjs
// @reads backend/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs} frontend/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs} backend/tsconfig.json frontend/tsconfig.json
// The file-system half of the structure ratchets: walks each project's `src/`,
// reads every source file once and hands the texts to the pure scanner
// (scanner.mjs). Kept apart so the scanner's unit tests reach no file reader
// and are selected only when the scanner itself changes.
import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { posix } from "node:path"
import { fileURLToPath } from "node:url"
import { buildGraph, isSourceFile } from "./scanner.mjs"

export const PROJECTS = [
  { name: "backend", dir: "backend", src: "backend/src" },
  { name: "frontend", dir: "frontend", src: "frontend/src" },
]

/** The repo's own TypeScript — the guards add no dependency. */
export function loadTypeScript(root) {
  return createRequire(new URL("package.json", root))("typescript")
}

/**
 * `compilerOptions.paths` of a project's tsconfig as repo-relative aliases
 * (`@/*` → `frontend/src/*`). A target outside the scanned tree (`react` →
 * `../node_modules/@types/react`) simply never resolves.
 */
export function readTsconfigAliases(ts, root, projectDir) {
  const cfg = ts.readConfigFile(fileURLToPath(new URL(`${projectDir}/tsconfig.json`, root)), ts.sys.readFile)
  if (cfg.error) throw new Error(`${projectDir}/tsconfig.json: ${ts.flattenDiagnosticMessageText(cfg.error.messageText, "\n")}`)
  const out = []
  for (const [pattern, targets] of Object.entries(cfg.config?.compilerOptions?.paths ?? {})) {
    if (!Array.isArray(targets) || targets.length === 0) continue
    out.push({ pattern, target: posix.normalize(posix.join(projectDir, targets[0])) })
  }
  return out
}

function walk(root, dir, out) {
  for (const e of readdirSync(new URL(`${dir}/`, root), { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) walk(root, p, out)
    else if (isSourceFile(p)) out.push(p)
  }
}

/** Scans a project's `src/` once (each file parsed once). */
export function scanProject(ts, root, project) {
  const paths = []
  walk(root, project.src, paths)
  const sources = new Map(paths.map((p) => [p, readFileSync(new URL(p, root), "utf8")]))
  return { name: project.name, ...buildGraph(ts, sources, readTsconfigAliases(ts, root, project.dir)) }
}
