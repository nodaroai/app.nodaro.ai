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

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"

const REPO_ROOT = join(__dirname, "..", "..", "..")
const FRONTEND_API_FILE = join(REPO_ROOT, "frontend/src/lib/api.ts")
const BACKEND_ROUTES_DIR = join(REPO_ROOT, "backend/src/routes")
const EE_BACKEND_ROUTES_DIR = join(REPO_ROOT, "backend/src/ee/routes")

/**
 * Replace ${expr} with `:p`, properly handling nested braces.
 */
function substituteTemplateExprs(text: string): string {
  let result = ""
  let i = 0
  while (i < text.length) {
    if (text[i] === "$" && text[i + 1] === "{") {
      let depth = 1
      i += 2
      while (i < text.length && depth > 0) {
        if (text[i] === "{") depth++
        else if (text[i] === "}") depth--
        i++
      }
      result += ":p"
    } else {
      result += text[i]
      i++
    }
  }
  return result
}

function normalizePath(path: string | null): string | null {
  if (!path) return null
  let p = path.replace(/\?.*$/, "").replace(/#.*$/, "")
  // Skip docstring placeholders like /v1/api/run/EXECUTION_ID — segments
  // that are ALL_CAPS_WITH_UNDERSCORES are convention placeholders, not
  // real route paths.
  if (p.split("/").some((seg) => /^[A-Z][A-Z0-9_]{2,}$/.test(seg))) return null
  p = p.replace(/:[a-zA-Z][a-zA-Z0-9]*/g, ":p")
  // Iteratively strip trailing-:p artifacts where the ":p" is preceded by a
  // non-slash char. These come from templates like `/v1/foo${qs}` — the
  // ${qs} substituted to ":p" but it's not a real path param, just a query
  // string or conditional.
  let prev: string
  do {
    prev = p
    p = p.replace(/([^/]):p/g, "$1")
  } while (p !== prev)
  if (p.endsWith("/") && p !== "/v1/") p = p.slice(0, -1)
  return p
}

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

/**
 * Extract route registrations from a backend file. Matches both
 * `app.<verb>(...)` and `<subapp>.<verb>(...)` forms (the latter for nested
 * Fastify instances created via `app.register(async (api) => { ... })`).
 */
function extractBackendV1Paths(src: string): Set<string> {
  const paths = new Set<string>()
  for (const m of src.matchAll(
    /\b\w+\.(?:get|post|put|patch|delete|head)\s*[<(][^"'`]*?["'`](\/v1\/[^"'`]+)["'`]/g,
  )) {
    const norm = normalizePath(m[1])
    if (norm) paths.add(norm)
  }
  return paths
}

function walkRouteFiles(dir: string): string[] {
  const out: string[] = []
  const stat = statSync(dir, { throwIfNoEntry: false })
  if (!stat) return out
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue
    const p = join(dir, entry)
    const s = statSync(p)
    if (s.isDirectory()) {
      out.push(...walkRouteFiles(p))
    } else if (
      s.isFile() &&
      entry.endsWith(".ts") &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".d.ts")
    ) {
      out.push(p)
    }
  }
  return out
}

const FRONTEND_API_SRC = readFileSync(FRONTEND_API_FILE, "utf8")
const FRONTEND_PATHS = extractFrontendV1Paths(FRONTEND_API_SRC)

const BACKEND_FILES = [
  ...walkRouteFiles(BACKEND_ROUTES_DIR),
  ...walkRouteFiles(EE_BACKEND_ROUTES_DIR),
]
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
// Allowlist for known scanner artifacts. Today empty — the scanner correctly
// resolves every api.ts path against backend. Add entries here ONLY for
// genuine scanner false-positives (with an explanation), never to mask
// real drift.
// ---------------------------------------------------------------------------

const KNOWN_FRONTEND_ARTIFACTS: ReadonlySet<string> = new Set<string>([])

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
