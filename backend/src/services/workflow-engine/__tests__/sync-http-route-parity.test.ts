/**
 * Regression test: every path in `SYNC_HTTP_ROUTES` must actually be a route
 * registered by one of the backend route modules.
 *
 * Historical bug: SYNC_HTTP_ROUTES had `/v1/scene-graph-ai/generate` but the
 * route was registered at `/v1/scene-graph/generate`. Every orchestrator run
 * of a video-composer node 404'd silently. This test locks in the correct
 * mapping so future route renames can't re-introduce the drift.
 *
 * A route the Nodaro Cloud plugin serves has no app route file to check
 * (`PLUGIN_SERVED_SYNC_ROUTES`): its node is Cloud only, its path is pinned
 * here, and the editor's call to the same path is the one other place it is
 * written (route-path-parity.test.ts holds the two together).
 */

import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { IDEMPOTENT_SYNC_HTTP_NODES, SYNC_HTTP_NODES, SYNC_HTTP_ROUTES } from "../node-executor.js"
import { PLUGIN_SERVED_SYNC_TYPES } from "../ugc-sync-nodes.js"
import { CLOUD_ONLY_NODE_TYPES } from "../../../lib/cloud-only-nodes.js"

/** The sync-HTTP routes the Nodaro Cloud plugin serves (the UGC nodes), by node type. */
const PLUGIN_SERVED_SYNC_ROUTES: Readonly<Record<string, string>> = {
  "ugc-creator": "/v1/ugc/creator",
  "ugc-script": "/v1/ugc/script",
  "ugc-clips": "/v1/ugc/clips",
  "ugc-clip": "/v1/ugc/clip",
  "ugc-cards": "/v1/ugc/cards",
  "ugc-finish-clips": "/v1/ugc/finish",
}
const isPluginServed = (nodeType: string): boolean => Object.hasOwn(PLUGIN_SERVED_SYNC_ROUTES, nodeType)

// Map each node type to the route source file that must contain its path.
// Multiple node types can map to the same file (e.g. all social posts).
const NODE_TYPE_TO_ROUTE_FILE: Record<string, string> = {
  "generate-3d-scene": "backend/src/routes/3d-scene.ts",
  "edit-3d-scene": "backend/src/routes/3d-scene.ts",
  "pro-3d-render": "backend/src/routes/pro-3d-render.ts",
  "ai-writer": "backend/src/routes/ai-writer.ts",
  "llm-chat": "backend/src/routes/llm-chat.ts",
  "video-composer": "backend/src/routes/scene-graph-ai.ts",
  "after-effects": "backend/src/routes/after-effects-ai.ts",
  "lottie-overlay": "backend/src/routes/lottie-overlay-ai.ts",
  "3d-title": "backend/src/routes/three-d-title-ai.ts",
  "motion-graphics": "backend/src/routes/motion-graphics-ai.ts",
  "image-to-text": "backend/src/routes/image-to-text.ts",
  "describe-to-picker": "backend/src/routes/describe-to-picker.ts",
  "suno-style-boost": "backend/src/routes/suno.ts",
  "qa-check": "backend/src/routes/qa-check.ts",
  "image-critic": "backend/src/routes/image-critic.ts",
  "save-to-storage": "backend/src/routes/save-to-storage.ts",
  "web-scrape": "backend/src/routes/web-scrape.ts",
  "meta-ads-scrape": "backend/src/routes/meta-ads-scrape.ts",
  "instagram-scrape": "backend/src/routes/instagram-scrape.ts",
  "instagram-post": "backend/src/routes/social-publish.ts",
  "tiktok-post": "backend/src/routes/social-publish.ts",
  "youtube-upload": "backend/src/routes/social-publish.ts",
  "linkedin-post": "backend/src/routes/social-publish.ts",
  "x-post": "backend/src/routes/social-publish.ts",
  "facebook-post": "backend/src/routes/social-publish.ts",
  "telegram-post": "backend/src/routes/social-publish.ts",
  "publish-social": "backend/src/routes/social-publish.ts",
  "telegram-channel-feed": "backend/src/routes/telegram-channel.ts",
  "reduce": "backend/src/routes/reduce.ts",
  "collection-write": "backend/src/routes/collection-nodes.ts",
  "collection-read": "backend/src/routes/collection-nodes.ts",
  "inspiration-read": "backend/src/routes/social-post-reads.ts",
  "competitor-read": "backend/src/routes/social-post-reads.ts",
}

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..")

describe("SYNC_HTTP_NODES ↔ SYNC_HTTP_ROUTES ↔ IDEMPOTENT_SYNC_HTTP_NODES", () => {
  // A type in one set but not the other dispatches wrong: listed in the routes
  // map only, it falls to the worker-queued path and buildPayload throws
  // "Unknown node type" mid-run (the payload-builder walk cannot see it — the
  // type is exempted there as sync-HTTP); listed in the set only, the executor
  // has no URL to post to. The two are one fact written twice; pin them equal.
  it("the dispatch set and the route map name the same node types", () => {
    const routed = new Set(Object.keys(SYNC_HTTP_ROUTES))
    const setOnly = [...SYNC_HTTP_NODES].filter((t) => !routed.has(t)).sort()
    const routesOnly = [...routed].filter((t) => !SYNC_HTTP_NODES.has(t)).sort()
    expect(setOnly, "in SYNC_HTTP_NODES but not SYNC_HTTP_ROUTES").toEqual([])
    expect(routesOnly, "in SYNC_HTTP_ROUTES but not SYNC_HTTP_NODES").toEqual([])
  })

  it("every node the orchestrator sends an Idempotency-Key for is a sync-HTTP node", () => {
    const stray = [...IDEMPOTENT_SYNC_HTTP_NODES].filter((t) => !SYNC_HTTP_NODES.has(t))
    expect(stray).toEqual([])
    // The routes that key on the header today, and the UGC nodes (every call
    // carries the run's key); a new member must be deliberate.
    expect([...IDEMPOTENT_SYNC_HTTP_NODES].sort()).toEqual([
      "collection-write", "pro-3d-render", "ugc-cards", "ugc-clip", "ugc-clips", "ugc-creator", "ugc-finish-clips", "ugc-script",
    ])
  })
})

describe("SYNC_HTTP_ROUTES ↔ registered route parity", () => {
  it("every orchestrator sync-HTTP node type has a mapped route file", () => {
    for (const nodeType of Object.keys(SYNC_HTTP_ROUTES)) {
      if (isPluginServed(nodeType)) continue
      expect(NODE_TYPE_TO_ROUTE_FILE[nodeType], nodeType).toBeDefined()
    }
  })

  it.each(Object.entries(SYNC_HTTP_ROUTES).filter(([nodeType]) => !isPluginServed(nodeType)))(
    "orchestrator path for %s must match a registered route in its route file",
    (nodeType, orchestratorPath) => {
      const relativeFile = NODE_TYPE_TO_ROUTE_FILE[nodeType]
      expect(relativeFile, `missing route file mapping for ${nodeType}`).toBeDefined()
      const source = readFileSync(join(REPO_ROOT, relativeFile), "utf8")
      // Route files register paths with `app.post("/v1/…"` — look for the exact
      // literal. This catches typos and missing route renames.
      const pattern = new RegExp(
        `app\\.post\\(\\s*["']${orchestratorPath.replace(/[/\-]/g, "\\$&")}["']`,
      )
      expect(source, `${relativeFile} does not register path ${orchestratorPath}`).toMatch(
        pattern,
      )
    },
  )
})

describe("SYNC_HTTP_ROUTES ↔ the routes the Nodaro Cloud plugin serves", () => {
  /** Every `.ts` file under a route directory, tests excluded. */
  const routeSources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return name === "__tests__" ? [] : routeSources(path)
      return name.endsWith(".ts") ? [readFileSync(path, "utf8")] : []
    })
  const APP_ROUTE_SOURCES = [join(REPO_ROOT, "backend/src/routes"), join(REPO_ROOT, "backend/src/ee/routes")].flatMap(routeSources)

  it("are exactly the executor's plugin-served nodes, each at its pinned path", () => {
    expect([...PLUGIN_SERVED_SYNC_TYPES].sort()).toEqual(Object.keys(PLUGIN_SERVED_SYNC_ROUTES).sort())
    for (const [nodeType, path] of Object.entries(PLUGIN_SERVED_SYNC_ROUTES)) {
      expect(SYNC_HTTP_NODES.has(nodeType), nodeType).toBe(true)
      expect(SYNC_HTTP_ROUTES[nodeType], nodeType).toBe(path)
    }
  })

  it("each is a Cloud-only node: off Cloud a graph holding it is refused, so no deployment without the plugin runs it", () => {
    const notCloudOnly = Object.keys(PLUGIN_SERVED_SYNC_ROUTES).filter((t) => !CLOUD_ONLY_NODE_TYPES.has(t))
    expect(notCloudOnly).toEqual([])
  })

  it("no app route file registers one of their paths (a route that did would be checked against its file above)", () => {
    expect(APP_ROUTE_SOURCES.length).toBeGreaterThan(100)
    for (const path of Object.values(PLUGIN_SERVED_SYNC_ROUTES)) {
      const literal = new RegExp(`\\.(?:post|get)\\(\\s*["']${path.replace(/[/\-]/g, "\\$&")}["']`)
      expect(APP_ROUTE_SOURCES.some((source) => literal.test(source)), path).toBe(false)
    }
    for (const nodeType of Object.keys(PLUGIN_SERVED_SYNC_ROUTES)) expect(NODE_TYPE_TO_ROUTE_FILE[nodeType], nodeType).toBeUndefined()
  })
})
