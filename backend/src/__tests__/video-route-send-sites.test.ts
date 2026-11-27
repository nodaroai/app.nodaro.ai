// @test-watches backend/src/**/*.ts
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Every video send states its ROUTE CONTEXT (docs/design/alternate-routes.md,
 * "Routing per model"): the job it runs for (`routeJob`), or that it has no
 * job row of its own (`routeRowless`, a plugin toolkit call). A job the admin
 * routed was priced on the route; a send site that forgets to say whose run it
 * is would quietly run it on the default upstream. So every call of
 * `imageToVideo(` / `textToVideo(` in the backend must pass one of them, by
 * name or through a variable that carries it — a new send site fails here
 * until it does.
 */
const SRC = join(__dirname, "..")

/** Names a call may pass its context through (each one is defined with `routeJob` / `routeRowless` beside its call). */
const CONTEXT_NAMES = ["routeJob", "routeRowless", "toVideoReconcileOpts", "voicedRoute", "t2vReconcile", "i2vReconcile"]

/** Files that DEFINE or FORWARD the calls rather than make a send of their own. */
const FORWARDERS = new Set([
  "providers/provider.interface.ts", // the interface
  "providers/router.ts", // forwards the caller's reconcileOpts unchanged
  "providers/kie/video.ts", // the provider itself
  "providers/replicate/video.ts",
  "providers/nodaro/video.ts",
  "lib/private-plugins/types.ts", // the plugin contract's types
])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === "__tests__" || name === "node_modules" || name === "_generated") continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(p)
  }
  return out
}

/** The text of the call starting at `open` (the index of its "("), balanced. */
function callText(src: string, open: number): string {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++
    else if (src[i] === ")" && --depth === 0) return src.slice(open, i + 1)
  }
  return src.slice(open)
}

describe("video send sites state their route context", () => {
  const sites: Array<{ file: string; line: number; ok: boolean }> = []
  for (const path of walk(SRC)) {
    const file = relative(SRC, path)
    if (FORWARDERS.has(file)) continue
    const src = readFileSync(path, "utf8")
    for (const m of src.matchAll(/\b(imageToVideo|textToVideo)\(/g)) {
      const before = src.slice(Math.max(0, m.index! - 12), m.index!)
      if (/(async|function)\s+$/.test(before)) continue // a definition
      const text = callText(src, m.index! + m[0].length - 1)
      sites.push({ file, line: src.slice(0, m.index!).split("\n").length, ok: CONTEXT_NAMES.some((n) => text.includes(n)) })
    }
  }

  it("finds the send sites (the scan itself works)", () => {
    expect(sites.length).toBeGreaterThanOrEqual(15)
  })

  it("every one passes routeJob or routeRowless", () => {
    expect(sites.filter((s) => !s.ok).map((s) => `${s.file}:${s.line}`)).toEqual([])
  })
})
