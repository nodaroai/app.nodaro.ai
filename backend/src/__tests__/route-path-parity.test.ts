// @test-watches frontend/src/lib/api.ts frontend/src/nodes/** backend/src/routes/**/*.ts backend/src/ee/routes/**/*.ts
/**
 * L1#9 — Frontend api.ts ↔ backend route registration walk.
 *
 * Every `/v1/...` path the frontend's `api.ts` calls (via fetch / template
 * literals) must resolve to a route registered backend-side. Drift here
 * causes silent 404s that survive type checking — the historical case was
 * `/v1/scene-graph-ai/generate` calling a route registered at
 * `/v1/scene-graph/generate`, breaking every video-composer node run.
 *
 * Scope: this test only walks `frontend/src/lib/api.ts` (the canonical API
 * client). Page-level raw-fetch sites are not covered — they're a small
 * minority and use the same paths via api.ts wrappers in practice. A
 * broader walk could be added in Phase 2 (L4#2: Frontend api.ts ↔ backend
 * Zod parity walker).
 *
 * Backend coverage: walks both `backend/src/routes/` and
 * `backend/src/ee/routes/`. Both `app.<verb>(...)` and `<subapp>.<verb>(...)`
 * (nested Fastify instances) registrations are detected.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { UGC_SYNC_ROUTES } from "../services/workflow-engine/ugc-sync-nodes.js"
import {
  allRouteFiles,
  extractBackendV1Paths,
  normalizePath,
  substituteTemplateExprs,
} from "../lib/route-inventory.js"

const REPO_ROOT = join(__dirname, "..", "..", "..")
const FRONTEND_API_FILE = join(REPO_ROOT, "frontend/src/lib/api.ts")

/**
 * Walk a frontend source file (typically api.ts) for /v1/... paths.
 * Handles both:
 *   - "/v1/..." or '/v1/...' string literals
 *   - `${BASE}/v1/...${id}/...` template literals (with brace-aware sub)
 */
function extractFrontendV1Paths(src: string): Set<string> {
  const paths = new Set<string>()
  // Quoted string literals
  for (const m of src.matchAll(/["'](\/v1\/[^"'\s]*)["']/g)) {
    const norm = normalizePath(m[1])
    if (norm) paths.add(norm)
  }
  // Backtick templates: state-machine scan to handle nested ${} properly
  let i = 0
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2
      continue
    }
    if (src[i] !== "`") {
      i++
      continue
    }
    const start = i + 1
    let j = start
    let depth = 0
    while (j < src.length) {
      if (src[j] === "\\") {
        j += 2
        continue
      }
      if (depth === 0 && src[j] === "`") break
      if (src[j] === "$" && src[j + 1] === "{") {
        depth++
        j += 2
        continue
      }
      if (src[j] === "}" && depth > 0) {
        depth--
        j++
        continue
      }
      j++
    }
    const tmpl = src.slice(start, j)
    const v1Idx = tmpl.indexOf("/v1/")
    if (v1Idx >= 0) {
      const fromV1 = tmpl.slice(v1Idx)
      const subbed = substituteTemplateExprs(fromV1)
      // Stop at whitespace/comma/paren/quote — these end the URL fragment.
      const stop = subbed.search(/[\s,)']/)
      const candidate = stop > 0 ? subbed.slice(0, stop) : subbed
      const norm = normalizePath(candidate)
      if (norm) paths.add(norm)
    }
    i = j + 1
  }
  return paths
}

const FRONTEND_API_SRC = readFileSync(FRONTEND_API_FILE, "utf8")
// lib/api.ts, plus every node unit's own client (frontend/src/nodes/<type>/api.ts).
const UNITS_DIR = join(REPO_ROOT, "frontend/src/nodes")
const UNIT_API_SRCS = readdirSync(UNITS_DIR)
  .filter((n) => !n.startsWith("_") && existsSync(join(UNITS_DIR, n, "api.ts")))
  .map((n) => readFileSync(join(UNITS_DIR, n, "api.ts"), "utf8"))
const FRONTEND_PATHS = new Set([FRONTEND_API_SRC, ...UNIT_API_SRCS].flatMap((src) => [...extractFrontendV1Paths(src)]))

const BACKEND_FILES = allRouteFiles(REPO_ROOT)
const BACKEND_PATHS = new Set<string>()
for (const f of BACKEND_FILES) {
  for (const p of extractBackendV1Paths(readFileSync(f, "utf8"))) {
    BACKEND_PATHS.add(p)
  }
}

// ---------------------------------------------------------------------------
// Sanity check on extraction.
// ---------------------------------------------------------------------------

describe("path extraction sanity", () => {
  it("found at least 100 frontend paths in api.ts", () => {
    expect(FRONTEND_PATHS.size).toBeGreaterThanOrEqual(100)
  })

  it("found at least 200 backend route registrations", () => {
    expect(BACKEND_PATHS.size).toBeGreaterThanOrEqual(200)
  })

  it("both extractions found a baseline of well-known paths", () => {
    expect(FRONTEND_PATHS.has("/v1/jobs")).toBe(true)
    expect(BACKEND_PATHS.has("/v1/jobs")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Allowlist for known scanner artifacts. Add entries here ONLY for genuine
// scanner false-positives (with an explanation), never to mask real drift.
// ---------------------------------------------------------------------------

const KNOWN_FRONTEND_ARTIFACTS: ReadonlySet<string> = new Set<string>([
  // 4b (2026-08-18): the five Nodaro-exclusive node paths (voice-changer-pro,
  // generate-video-pro (+ /stop, /continue), edit-video-pro, video-analysis
  // (+ /probe), video-audit) used to be allowlisted here as plugin-registered
  // runtime routes the scanner can't see. They now ALSO have a static route
  // file — backend/src/routes/nodaro-exclusive.ts, the self-hosted relay —
  // so the scanner resolves them and the entries were removed.
  //
  // a5 (2026-08-25): moderate-image is a cloud-plugins-provided route —
  // registered at runtime via @nodaroai/cloud-plugins `registerRoutes()`, which
  // the static scanner can't see. It has NO core/ee route by design (the
  // moderation implementation stays private, like the other plugin routes), so
  // it is intentionally absent from core and allowlisted here.
  "/v1/moderate-image",
  // The collaborator routes are organization routes, registered at runtime by
  // the cloud-plugins `registerRoutes()` the static scanner cannot see, and
  // deliberately absent from core: the membership tables, the settings
  // inheritance and the access rule they enforce are all the plugin's, and a
  // core stub would be a second implementation of a rule that already has two.
  // Their contract is published in docs/organizations.md and exercised by the
  // plugin's own route matrices.
  "/v1/workflows/:p/collaborators",
  "/v1/workflows/:p/collaborators/:p",
  // Telegram accounts are Cloud-only routes, registered at runtime by the
  // cloud-plugins `registerRoutes()` and deliberately absent from core: a
  // deployment without the plugin answers 404, which the Integrations card
  // reads as "not offered here" and renders nothing. The contract is the
  // plugin's own and exercised by its route tests.
  "/v1/telegram-accounts",
  "/v1/telegram-accounts/:p",
  "/v1/telegram-accounts/:p/pause",
  "/v1/telegram-accounts/:p/resume",
  "/v1/telegram-accounts/:p/chats",
  "/v1/telegram-accounts/consent",
  "/v1/telegram-accounts/login",
  "/v1/telegram-accounts/login/:p",
  "/v1/telegram-accounts/login/:p/code",
  "/v1/telegram-accounts/login/:p/password",
  // Content Recipe and Content Ideas are Cloud-only nodes (CLOUD_ONLY_NODE_TYPES,
  // no relay): their routes are registered at runtime by the cloud-plugins
  // `registerRoutes()` and deliberately absent from core — the prompts and
  // handlers are the plugin's. Off Cloud the pickers hide both nodes and the
  // workflow routes refuse a graph holding them, so nothing calls these there.
  "/v1/content-recipe",
  "/v1/content-ideas",
  // Social Search is a Cloud-only node (CLOUD_ONLY_NODE_TYPES, no relay): its
  // route is registered at runtime by the cloud-plugins `registerRoutes()` and
  // deliberately absent from core. Off Cloud the pickers hide the node and the
  // workflow routes refuse a graph holding it, so nothing calls it there.
  "/v1/social-search",
  // Competitor tracking: every route is the cloud-plugins `competitors`
  // plugin's (registered at runtime, deliberately absent from core). Off Cloud
  // the page is not offered and nothing calls them.
  "/v1/competitors",
  "/v1/competitors/:p",
  "/v1/competitors/cards",
  "/v1/competitors/:p/lessons",
  "/v1/competitors/:p/history",
  "/v1/competitors/:p/compare",
  "/v1/competitors/actions",
  "/v1/competitors/actions/:p",
  "/v1/competitor-scan",
  "/v1/competitor-discover",
  // UGC video: Cloud-only nodes (CLOUD_ONLY_NODE_TYPES, no relay), every route
  // served by the Nodaro Cloud plugin — registered at runtime by the
  // cloud-plugins `registerRoutes()` and deliberately absent from core. Off
  // Cloud the pickers hide the nodes and the workflow routes refuse a graph
  // holding them, so nothing calls these there. (The quote is the platform's
  // own: /v1/ugc/quote is an ee route the scanner resolves.)
  "/v1/ugc/creator",
  "/v1/ugc/categories",
  "/v1/ugc/script",
  "/v1/ugc/clips",
  "/v1/ugc/clip",
  "/v1/ugc/cards",
  // A video whose clips are cut from one recorded speech: UGC Clips' split and UGC Finish's finish (child jobs).
  "/v1/ugc/segments",
  "/v1/ugc/finish",
])

// ---------------------------------------------------------------------------
// Test 1 — every frontend api.ts path resolves to a backend route.
// ---------------------------------------------------------------------------

describe("frontend api.ts paths resolve to backend routes", () => {
  it.each([...FRONTEND_PATHS].sort())(
    'frontend path "%s" is registered in backend/src/routes/ or backend/src/ee/routes/',
    (path) => {
      if (KNOWN_FRONTEND_ARTIFACTS.has(path)) return
      expect(
        BACKEND_PATHS.has(path),
        `Frontend api.ts calls "${path}" but no matching route is registered in backend/src/routes/ or backend/src/ee/routes/. This will cause silent 404s — type checks pass but the request fails at runtime. Either: (a) add the missing backend route handler, (b) fix the path on either side if there's a typo, or (c) if this is a scanner false-positive (e.g., dynamically constructed URL the static analyzer misread), add it to KNOWN_FRONTEND_ARTIFACTS in this test file with an explanation.`,
      ).toBe(true)
    },
  )
})

// ---------------------------------------------------------------------------
// Test 2 — KNOWN_FRONTEND_ARTIFACTS integrity.
// ---------------------------------------------------------------------------

describe("KNOWN_FRONTEND_ARTIFACTS integrity", () => {
  it("every artifact entry is still flagged by the scanner", () => {
    const stale = [...KNOWN_FRONTEND_ARTIFACTS].filter(
      (p) => !FRONTEND_PATHS.has(p),
    )
    expect(
      stale,
      `These KNOWN_FRONTEND_ARTIFACTS entries are no longer extracted by the scanner — remove them: ${stale.join(", ")}`,
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Test 3 — the orchestrator's plugin-served sync routes are the editor's calls.
// ---------------------------------------------------------------------------

// The orchestrator posts each UGC node to a route the Nodaro Cloud plugin
// registers at runtime, which no app route file holds
// (sync-http-route-parity.test.ts). The editor calls the same routes from
// api.ts, allowlisted above as plugin routes. A path written two ways would
// reach the route from one engine and 404 from the other, so the two lists must
// agree: every path the orchestrator posts to is one the editor calls.
describe("the orchestrator's plugin-served sync routes agree with the editor's calls", () => {
  it("every one is a plugin route the editor calls (allowlisted above)", () => {
    const notAllowlisted = Object.values(UGC_SYNC_ROUTES).filter((path) => !KNOWN_FRONTEND_ARTIFACTS.has(path))
    expect(
      notAllowlisted,
      `The orchestrator posts to these plugin routes, but the editor's api.ts does not call them as allowlisted plugin routes: ${notAllowlisted.join(", ")}`,
    ).toEqual([])
  })
})
