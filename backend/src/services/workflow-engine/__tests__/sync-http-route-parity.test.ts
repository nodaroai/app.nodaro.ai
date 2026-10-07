/**
 * Regression test: every path in `SYNC_HTTP_ROUTES` must actually be a route
 * registered by one of the backend route modules.
 *
 * Historical bug: SYNC_HTTP_ROUTES had `/v1/scene-graph-ai/generate` but the
 * route was registered at `/v1/scene-graph/generate`. Every orchestrator run
 * of a video-composer node 404'd silently. This test locks in the correct
 * mapping so future route renames can't re-introduce the drift.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { IDEMPOTENT_SYNC_HTTP_NODES, SYNC_HTTP_NODES, SYNC_HTTP_ROUTES } from "../node-executor.js"

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
    // The two routes that key on the header today; a new member must be deliberate.
    expect([...IDEMPOTENT_SYNC_HTTP_NODES].sort()).toEqual(["collection-write", "pro-3d-render"])
  })
})

describe("SYNC_HTTP_ROUTES ↔ registered route parity", () => {
  it("every orchestrator sync-HTTP node type has a mapped route file", () => {
    for (const nodeType of Object.keys(SYNC_HTTP_ROUTES)) {
      expect(NODE_TYPE_TO_ROUTE_FILE[nodeType]).toBeDefined()
    }
  })

  it.each(Object.entries(SYNC_HTTP_ROUTES))(
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
