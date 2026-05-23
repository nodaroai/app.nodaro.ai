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
import { SYNC_HTTP_ROUTES } from "../node-executor.js"

// Map each node type to the route source file that must contain its path.
// Multiple node types can map to the same file (e.g. all social posts).
const NODE_TYPE_TO_ROUTE_FILE: Record<string, string> = {
  "ai-writer": "backend/src/routes/ai-writer.ts",
  "llm-chat": "backend/src/routes/llm-chat.ts",
  "video-composer": "backend/src/routes/scene-graph-ai.ts",
  "after-effects": "backend/src/routes/after-effects-ai.ts",
  "lottie-overlay": "backend/src/routes/lottie-overlay-ai.ts",
  "3d-title": "backend/src/routes/three-d-title-ai.ts",
  "motion-graphics": "backend/src/routes/motion-graphics-ai.ts",
  "image-to-text": "backend/src/routes/image-to-text.ts",
  "suno-style-boost": "backend/src/routes/suno.ts",
  "qa-check": "backend/src/routes/qa-check.ts",
  "image-critic": "backend/src/routes/image-critic.ts",
  "save-to-storage": "backend/src/routes/save-to-storage.ts",
  "web-scrape": "backend/src/routes/web-scrape.ts",
  "instagram-post": "backend/src/routes/social-publish.ts",
  "tiktok-post": "backend/src/routes/social-publish.ts",
  "youtube-upload": "backend/src/routes/social-publish.ts",
  "linkedin-post": "backend/src/routes/social-publish.ts",
  "x-post": "backend/src/routes/social-publish.ts",
  "facebook-post": "backend/src/routes/social-publish.ts",
  "telegram-post": "backend/src/routes/social-publish.ts",
  "reduce": "backend/src/routes/reduce.ts",
}

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..")

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
