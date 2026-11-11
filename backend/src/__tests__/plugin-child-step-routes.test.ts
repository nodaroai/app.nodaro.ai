// @test-watches backend/src/**/*.ts
/**
 * TOTALITY for "a step a plugin engine's job sends is gated as the node the
 * user ran" (lib/child-step-node.ts, decided 2026-11-10). The rule lives in the
 * two node gates a route can attach — the credit guard and
 * `requireNodeAvailable` — so a step route stays covered only while its node
 * is judged there. This holds:
 *  - each route Nodaro Motion's job sends a step to (read from the Cloud
 *    plugin's source) is registered here and judges no node by itself (an
 *    inline `isNodeDeniedForUser`, say), which would gate the step by its own
 *    node again;
 *  - both node gates ask `childStepNodeType` first;
 *  - every job name of the plugin that sends steps resolves to its node.
 * A new step route joins STEP_ROUTES when the plugin starts calling it.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { allRouteFiles, extractRouteRegistrations } from "../lib/route-inventory.js"
import { nodeOfJobType } from "../lib/route-node-gate.js"

const REPO_ROOT = join(__dirname, "..", "..", "..")

/** Every route plugin 0.464.0's Nodaro Motion job (`tk.http.workerRequest`) sends a step to. */
const STEP_ROUTES = [
  "POST /v1/generate-image",
  "POST /v1/generate-video",
  "POST /v1/video-upscale",
  "POST /v1/video-depth",
  "POST /v1/mask-composite",
  "POST /v1/video-mask",
  "POST /v1/audio-separation",
  "POST /v1/llm-chat/generate",
  "POST /v1/video-face-mesh",
  "POST /v1/video-scene-cuts",
  "POST /v1/jobs/:p/cancel",
]

/** The job names of plugin 0.464.0 whose handlers send those steps. */
const STEP_SENDING_JOBS = ["cast-swap", "cast-swap-full-quality", "cast-swap-face-mask"]

/** A node judged inside a route file, past the two gates the rule lives in. */
const INLINE_NODE_CHECK = /\b(?:isNodeDeniedForUser|isNodeDenied|deniedCapabilityForUser|deniedRouteCapabilityForUser|assertNodeAvailableForUser|findDeniedNodeTypes(?:ForUser)?)\(/

/** The step routes that judge no node at all: they are steps only (or run no node). */
const NO_NODE_GATE: Readonly<Record<string, string>> = {
  "POST /v1/video-scene-cuts": "an internal step only (`createsChildJob`), with no node of its own and no credit guard",
  "POST /v1/jobs/:p/cancel": "cancels a job the caller owns: no node runs",
}

/**
 * Every backend source that judges a node itself, outside the two gates that
 * apply the rule — each is no route a plugin engine's job sends a step to.
 * A new one fails here until it says so (or moves its check into a gate).
 */
const JUDGES_NODES_ITSELF: Readonly<Record<string, string>> = {
  "lib/surface-deny.ts": "defines the node predicates",
  "lib/availability-viewer.ts": "the funnel: `requireNodeAvailable` asks childStepNodeType first; the other helpers serve the doors below",
  "middleware/credit-guard.ts": "the credit guard: asks childStepNodeType first",
  "routes/nodes.ts": "node discovery (GET /v1/nodes): lists what the caller may add",
  "routes/workflows.ts": "the workflow write guards: a saved graph's node types, not a step",
  "routes/voice-design.ts": "Voice Design's own route, which no plugin engine's job calls",
  "routes/voice-remix.ts": "Voice Remix's own route, which no plugin engine's job calls",
  "routes/use-case-run.ts": "a use-case node's run (its graph's nodes are judged at dispatch)",
  "routes/use-case-continue.ts": "a use-case node's continue",
  "lib/use-case/inner-availability.ts": "which inner nodes a use-case run may use",
  "services/scene3d/scene3d-engine.ts": "the 3D scene engine's lane choice (Pro vs Basic) for its own route",
  "services/workflow-engine/node-executor.ts": "the workflow engine's door for a graph's node (no plugin step)",
  "services/workflow-engine/payload-builder.ts": "the workflow engine's build of a graph's node",
  "lib/mcp/tools/workflows.ts": "the MCP workflow write guard: a written graph's node types",
  "lib/mcp/tools/cast-swap.ts": "lists the MCP tool only where its node is offered",
  "lib/mcp/tools/cast-swap-full-quality.ts": "lists the MCP tools only where their node is offered",
  "lib/mcp/tools/trends.ts": "lists the MCP tools only where their node is offered",
  "lib/mcp/tools/verbs-shot-cuts.ts": "lists the MCP tool only where its node is offered",
  "lib/mcp/tools/verbs-site-capture.ts": "lists the MCP tool only where its node is offered",
  "lib/mcp/tools/verbs-speaker-map.ts": "lists the MCP tool only where its node is offered",
  "lib/mcp/tools/verbs-speaker-view.ts": "lists the MCP tool only where its node is offered",
  "lib/mcp/tools/verbs-use-case.ts": "lists the MCP tools only where their node is offered",
  "lib/mcp/tools/pipelines.ts": "lists the pipeline tools only where the film pipeline is offered, and refuses a stale call before the services it calls directly (no route)",
  "lib/mcp/tools/video-director-tools.ts": "lists the MCP tools only where the Video Director is offered",
  "ee/pipelines/engine.ts": "the pipeline engine's check before each stage it runs, asked as the pipeline's owner (a worker, no route)",
  "lib/private-plugins/toolkit.ts": "`tk.pipelines.createSeeded`: a seeded pipeline is the film pipeline whoever asks for it (a toolkit method, no route)",
}

const BACKEND_SRC = join(REPO_ROOT, "backend/src")

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules" || entry === "test") continue
      sourceFiles(path, out)
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
      out.push(path)
    }
  }
  return out
}

/** Code without comments (a comment naming a check is not one). */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

/** The text of `route`'s registration, from its `app.<method>(` to its handler. */
function registrationOf(route: string): string {
  const [method, path] = route.split(" ") as [string, string]
  const pattern = new RegExp(`app\\.${method.toLowerCase()}(?:<[^>]*>)?\\(\\s*["\`]${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:p\b/g, ":[A-Za-z_][A-Za-z0-9_]*")}["\`]`)
  for (const f of routeFiles) {
    const m = pattern.exec(f.text)
    if (!m) continue
    const end = f.text.indexOf("async (req", m.index)
    return f.text.slice(m.index, end === -1 ? undefined : end)
  }
  throw new Error(`${route}: no registration found`)
}

const routeFiles = allRouteFiles(REPO_ROOT).map((path) => {
  const text = code(readFileSync(path, "utf8"))
  return { rel: path.slice(REPO_ROOT.length + 1).split("\\").join("/"), text, routes: new Set(extractRouteRegistrations(text).map((r) => `${r.method} ${r.path}`)) }
})

describe("every route a plugin engine's job sends a step to is gated as the parent's node", () => {
  it("each step route is registered here", () => {
    expect(STEP_ROUTES.filter((route) => !routeFiles.some((f) => f.routes.has(route)))).toEqual([])
  })

  it("no step route's file judges a node by itself (the step would be gated by its own node again)", () => {
    const inline = STEP_ROUTES.flatMap((route) => routeFiles.filter((f) => f.routes.has(route) && INLINE_NODE_CHECK.test(f.text)).map((f) => `${route} (${f.rel})`))
    expect(inline).toEqual([])
  })

  it("the four routes Motion's masking steps reach attach the shared credit guard in their own registration", () => {
    for (const route of ["POST /v1/video-depth", "POST /v1/mask-composite", "POST /v1/video-mask", "POST /v1/audio-separation"]) {
      expect(registrationOf(route), route).toMatch(/\bcreditGuard\(/)
    }
  })

  it("a step route that attaches no node gate is one that judges no node, and says so", () => {
    for (const route of STEP_ROUTES) {
      const gated = /\bcreditGuard\(|\brequireNodeAvailable\(/.test(registrationOf(route))
      expect(gated || Object.hasOwn(NO_NODE_GATE, route), `${route} attaches no node gate`).toBe(true)
      if (Object.hasOwn(NO_NODE_GATE, route)) expect(gated, `${route} is listed as gating no node`).toBe(false)
    }
  })

  it("every source that judges a node itself is no step route, and says why", () => {
    const judges = sourceFiles(BACKEND_SRC)
      .map((path) => ({ rel: path.slice(BACKEND_SRC.length + 1).split("\\").join("/"), text: code(readFileSync(path, "utf8")) }))
      .filter((f) => INLINE_NODE_CHECK.test(f.text))
      .map((f) => f.rel)
    expect(judges.filter((rel) => !JUDGES_NODES_ITSELF[rel])).toEqual([])
    expect(Object.keys(JUDGES_NODES_ITSELF).filter((rel) => !judges.includes(rel))).toEqual([])
  })

  it("both node gates a route attaches ask childStepNodeType first", () => {
    const guard = code(readFileSync(join(REPO_ROOT, "backend/src/middleware/credit-guard.ts"), "utf8"))
    expect(guard).toMatch(/const childNode = await childStepNodeType\(req\)/)
    const viewer = code(readFileSync(join(REPO_ROOT, "backend/src/lib/availability-viewer.ts"), "utf8"))
    const requireNode = viewer.slice(viewer.indexOf("export function requireNodeAvailable("), viewer.indexOf("export async function assertNodeAvailableForUser("))
    expect(requireNode).toMatch(/await childStepNodeType\(req\)/)
  })

  it("every job name that sends steps resolves to its node", () => {
    for (const job of STEP_SENDING_JOBS) expect(nodeOfJobType(job), job).toBe("cast-swap")
  })
})
