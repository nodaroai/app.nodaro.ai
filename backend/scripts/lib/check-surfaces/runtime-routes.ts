/**
 * `check:surfaces --runtime`: the exact route set of one edition, from
 * booting the app (`buildApp()` + `ready()`) in a child process with an
 * onRoute collector on every Fastify instance (capture-routes.ts). It sees
 * what the static scan cannot: routes the Cloud plugin registers when it is
 * installed, sub-app registrations and edition-gated routes.
 */
import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { normalizePath } from "../../../src/lib/route-inventory.js"
import { captureEnv, startOfflineDatabase, type Edition } from "../gen-skills/tool-surface.js"
import type { Classifier, RouteEntry } from "./routes.js"

const CHILD = join(dirname(fileURLToPath(import.meta.url)), "capture-routes.ts")

export async function runtimeRoutes(repoRoot: string, edition: Edition, classify: Classifier, staticSet: RouteEntry[]): Promise<RouteEntry[]> {
  const dir = mkdtempSync(join(tmpdir(), "check-surfaces-routes-"))
  const out = join(dir, "routes.json")
  const database = await startOfflineDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [...process.execArgv, CHILD, out], {
        cwd: join(repoRoot, "backend"),
        // The Cloud plugin is loaded when it is installed; without it Cloud
        // boots degraded and its routes stay bucketed by the declared prefixes.
        env: { ...captureEnv(edition, join(dir, "no.env"), database.url), PRIVATE_MODULES: "optional" },
        stdio: ["ignore", "ignore", "inherit"],
      })
      child.on("error", reject)
      child.on("exit", (code, signal) =>
        code === 0 ? resolve() : reject(new Error(`booting the ${edition} app to list its routes failed (exit ${code ?? signal})`)),
      )
    })
    const captured = JSON.parse(readFileSync(out, "utf8")) as CapturedRoute[]
    return joinCapturedRoutes(captured, edition, classify, staticSet)
  } finally {
    await database.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

export interface CapturedRoute {
  method: string
  url: string
}

/** The booted app's routes as route entries; one the static scan also found keeps its file (and so its bucket). */
export function joinCapturedRoutes(captured: readonly CapturedRoute[], edition: Edition, classify: Classifier, staticSet: readonly RouteEntry[]): RouteEntry[] {
  const known = new Map(staticSet.map((r) => [`${r.method} ${r.path}`, r]))
  const seen = new Set<string>()
  const routes: RouteEntry[] = []
  for (const { method, url } of captured) {
    const path = url.startsWith("/v1/") ? normalizePath(url) : url
    if (!path) continue
    const key = `${method} ${path}`
    if (seen.has(key)) continue
    seen.add(key)
    const k = known.get(key)
    const bucket = classify(method, path)
    // A route the app actually registered is served, so it is scored: the
    // `plugin` bucket is only for declared plugin routes nothing registered
    // (as in staticRoutes).
    routes.push(k ?? { method, path, ref: `runtime:${edition}`, bucket: bucket === "plugin" ? "public" : bucket, anonymous: false })
  }
  return routes
}
