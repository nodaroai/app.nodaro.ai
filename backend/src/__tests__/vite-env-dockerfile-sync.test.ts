/**
 * L1#8 — VITE_* env var × Dockerfile coverage.
 *
 * Vite inlines `import.meta.env.VITE_*` references at BUILD time. The
 * Railway Dockerfile is what builds the frontend in production, so every
 * `VITE_*` referenced in the frontend MUST have both `ARG VITE_X` AND
 * `ENV VITE_X` lines in the Dockerfile — otherwise the variable is
 * `undefined` in the production bundle and the feature it gates breaks
 * silently.
 *
 * References are collected from BOTH `import.meta.env.VITE_*` in
 * `frontend/src/` AND `%VITE_*%` placeholders in the HTML entry
 * (`frontend/index.html`) — Vite substitutes both at build time. The
 * analytics snippet (Clarity/GA) lives ONLY in index.html, so scanning
 * src/ alone would wrongly report VITE_CLARITY_ID / VITE_GA_ID as orphan
 * ARGs (and miss the requirement that they have ARG/ENV lines).
 *
 * Memory-noted bug class: this has bitten before. The error mode is
 * silent — the build succeeds, the bundle ships, the feature just doesn't
 * work in prod.
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"

// REPO_ROOT: backend/src/__tests__/ → up 3 → repo root
const REPO_ROOT = join(__dirname, "..", "..", "..")
const FRONTEND_SRC = join(REPO_ROOT, "frontend/src")
const FRONTEND_INDEX_HTML = join(REPO_ROOT, "frontend/index.html")
const DOCKERFILE_PATH = join(REPO_ROOT, "Dockerfile")

/**
 * Recursively walk frontend/src and collect every `import.meta.env.VITE_*`
 * reference. Skips test files and dist/node_modules.
 */
function walkFrontendForViteRefs(dir: string): Set<string> {
  const refs = new Set<string>()
  function visit(d: string) {
    for (const entry of readdirSync(d)) {
      // Skip non-source dirs and test files.
      if (
        entry === "node_modules" ||
        entry === "dist" ||
        entry === "__tests__" ||
        entry.endsWith(".test.ts") ||
        entry.endsWith(".test.tsx")
      ) {
        continue
      }
      const p = join(d, entry)
      const s = statSync(p)
      if (s.isDirectory()) {
        visit(p)
      } else if (s.isFile() && /\.(tsx?|jsx?)$/.test(entry)) {
        const src = readFileSync(p, "utf8")
        for (const m of src.matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) {
          refs.add(m[1])
        }
      }
    }
  }
  visit(dir)
  return refs
}

/**
 * Vite also substitutes `%VITE_*%` placeholders in the HTML entry
 * (frontend/index.html) at build time — e.g. the Clarity/GA analytics
 * snippet reads %VITE_CLARITY_ID% / %VITE_GA_ID%. These never appear as
 * `import.meta.env` in src/, so the src walk alone would wrongly flag them
 * as orphan Dockerfile ARGs. Scan the HTML entry for both forms.
 */
function collectHtmlViteRefs(file: string): Set<string> {
  const refs = new Set<string>()
  const html = readFileSync(file, "utf8")
  for (const m of html.matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) {
    refs.add(m[1])
  }
  for (const m of html.matchAll(/%(VITE_[A-Z0-9_]+)%/g)) {
    refs.add(m[1])
  }
  return refs
}

const FRONTEND_VITE_REFS = new Set<string>([
  ...walkFrontendForViteRefs(FRONTEND_SRC),
  ...collectHtmlViteRefs(FRONTEND_INDEX_HTML),
])

const DOCKERFILE_CONTENT = readFileSync(DOCKERFILE_PATH, "utf8")
const DOCKERFILE_ARG_VITE = new Set(
  [...DOCKERFILE_CONTENT.matchAll(/^\s*ARG\s+(VITE_[A-Z0-9_]+)/gm)].map(
    (m) => m[1],
  ),
)
const DOCKERFILE_ENV_VITE = new Set(
  [...DOCKERFILE_CONTENT.matchAll(/^\s*ENV\s+(VITE_[A-Z0-9_]+)/gm)].map(
    (m) => m[1],
  ),
)

// ---------------------------------------------------------------------------
// Sanity check on extraction.
// ---------------------------------------------------------------------------

describe("VITE_* extraction sanity", () => {
  it("found at least 3 VITE_* references in frontend (src + index.html)", () => {
    expect(FRONTEND_VITE_REFS.size).toBeGreaterThanOrEqual(3)
  })

  it("Dockerfile has at least one ARG VITE_* and one ENV VITE_*", () => {
    expect(DOCKERFILE_ARG_VITE.size).toBeGreaterThanOrEqual(1)
    expect(DOCKERFILE_ENV_VITE.size).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Test 1 — every frontend VITE_* reference has a matching `ARG` line in the
// Dockerfile (the build-arg passthrough).
// ---------------------------------------------------------------------------

describe("Frontend VITE_* references are declared as Dockerfile ARGs", () => {
  it.each([...FRONTEND_VITE_REFS].sort())(
    'Dockerfile has "ARG %s"',
    (variable) => {
      expect(
        DOCKERFILE_ARG_VITE.has(variable),
        `Frontend code references "import.meta.env.${variable}" but Dockerfile has no "ARG ${variable}" line. Vite inlines VITE_* at build time — without the ARG, the build context can't pass the value through to the frontend-build stage and the reference becomes \`undefined\` in production. Add "ARG ${variable}" near the top of the frontend-build stage in Dockerfile.`,
      ).toBe(true)
    },
  )
})

// ---------------------------------------------------------------------------
// Test 2 — every frontend VITE_* reference has a matching `ENV` line in the
// Dockerfile (the runtime->build-time environment plumbing).
// ---------------------------------------------------------------------------

describe("Frontend VITE_* references are declared as Dockerfile ENVs", () => {
  it.each([...FRONTEND_VITE_REFS].sort())(
    'Dockerfile has "ENV %s"',
    (variable) => {
      expect(
        DOCKERFILE_ENV_VITE.has(variable),
        `Frontend code references "import.meta.env.${variable}" but Dockerfile has no "ENV ${variable}" line. Without the ENV directive, the frontend-build stage's vite invocation doesn't see the build arg's value. Add "ENV ${variable}=$\{${variable}}" right after the matching ARG line.`,
      ).toBe(true)
    },
  )
})

// ---------------------------------------------------------------------------
// Test 3 — informational: Dockerfile ARGs that aren't referenced anywhere in
// the frontend (probably stale). Soft check via allowlist so harmless extras
// (server-side env vars that share VITE_ prefix by accident) don't fail CI.
// ---------------------------------------------------------------------------

const KNOWN_DOCKERFILE_ONLY_VITE_VARS: ReadonlySet<string> = new Set<string>([
  // Add intentional Dockerfile-only entries here with a comment explaining why.
  // Most VITE_* should be used in the frontend; entries here are exceptions.
])

describe("Dockerfile VITE_* ARGs are referenced by frontend (or allowlisted)", () => {
  it("every Dockerfile ARG VITE_* has a frontend reference or an allowlist entry", () => {
    const orphanArgs = [...DOCKERFILE_ARG_VITE].filter(
      (v) =>
        !FRONTEND_VITE_REFS.has(v) && !KNOWN_DOCKERFILE_ONLY_VITE_VARS.has(v),
    )
    expect(
      orphanArgs,
      `These Dockerfile ARGs are no longer referenced in frontend/src/ or frontend/index.html. Either remove them (likely stale from a removed feature), or add to KNOWN_DOCKERFILE_ONLY_VITE_VARS with a reason: ${orphanArgs.join(", ")}`,
    ).toEqual([])
  })
})
