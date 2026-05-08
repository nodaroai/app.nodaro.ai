/**
 * L1#3 — Edition gating import-level check.
 *
 * Three editions: cloud (everything), business (hasAdmin only, no
 * hasCredits), community (neither). Code that depends on credits must be
 * gated behind `hasCredits()`; admin paths must be gated behind
 * `hasAdmin()`. Without these gates, a Business or Community build crashes
 * at module load time when it tries to invoke credit/admin code that
 * references missing tables/secrets.
 *
 * A full AST-walk of every credit/admin call site is the spec's ideal
 * (per L1#3 Phase 2 spec line 87) but heavy. This test ships a simpler
 * import-level invariant:
 *
 *   1. Files that import from `ee/billing/` (credit code) MUST also
 *      import `hasCredits` from `lib/config`.
 *   2. Files that import from `ee/admin*` or use `checkIsAdmin` MUST
 *      also import `hasAdmin` from `lib/config`.
 *
 * The function-level gate isn't enforced — a malicious developer could
 * import `hasCredits` and never call it. But "forgot to import the gate
 * at all" is the common drift this test catches.
 *
 * Companion: tools/check-ee-imports.mjs handles the broader EE-boundary
 * check (ALLOWLIST of files allowed to import from ee/). This test is
 * additive — it requires the gate import alongside the ee/ import.
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, sep } from "node:path"
import { describe, it, expect } from "vitest"

const REPO_ROOT = join(__dirname, "..", "..", "..")
const BACKEND_SRC = join(REPO_ROOT, "backend/src")

function isEEPath(path: string): boolean {
  return path.split(sep).includes("ee") || /\.ee\.[a-z]+$/.test(path)
}

function walkTs(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue
    const p = join(dir, entry)
    const s = statSync(p)
    if (s.isDirectory()) {
      out.push(...walkTs(p))
    } else if (
      s.isFile() &&
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".d.ts")
    ) {
      out.push(p)
    }
  }
  return out
}

const ALL_FILES = walkTs(BACKEND_SRC).filter((p) => !isEEPath(p))

/**
 * Files that legitimately import from ee/billing/ without needing the
 * `hasCredits` gate import. Each entry MUST have a comment naming the
 * reason. Generally this is reserved for the credit-guard shim itself
 * (which IS the gate) and the entry-point boot files.
 */
const NO_GATE_REQUIRED_FOR_BILLING_IMPORT: ReadonlySet<string> = new Set<string>([
  // The shim that provides the gated API to all callers. credit-guard.ts
  // imports from ee/billing/ to dispatch when hasCredits() is true. The
  // hasCredits check is INSIDE this file's exported functions, not at the
  // call site — by design, so callers don't need to know.
  "middleware/credit-guard.ts",
  // Boot orchestrator. Routes registered here are themselves gated; the
  // imports are gated at registration call (per check-ee-imports.mjs
  // PERMANENT allowlist).
  "app.ts",
  "server.ts",
  // Phase 3.5 migration backlog — these match the ALLOWLIST in
  // tools/check-ee-imports.mjs. Each currently imports from ee/billing/
  // for credit-related reads (estimateWorkflowCredits, STATIC_CREDIT_COSTS,
  // CreditsService) but doesn't gate behind hasCredits at the import level.
  // They DO gate the runtime call (so non-cloud editions still load these
  // files cleanly via dynamic-require shim), but the import statement
  // itself forces ee/ to load. Tracked for cleanup; the gate-import test
  // is satisfied by the allowlist until that migration ships.
  "lib/collect-app-r2-keys.ts",
  "lib/mcp/tools/models.ts",
  "lib/node-registry.ts",
  "routes/after-effects-ai.ts",
  "routes/ai-writer.ts",
  "routes/api-tokens.ts",
  "routes/app-runner.ts",
  "routes/cancel-jobs.ts",
  "routes/component-execute.ts",
  "routes/generate-video.ts",
  "routes/image-to-text.ts",
  "routes/llm-chat.ts",
  "routes/lottie-overlay-ai.ts",
  "routes/motion-graphics-ai.ts",
  "routes/presentation.ts",
  "routes/prompt-helper.ts",
  "routes/published-apps.ts",
  "routes/qa-check.ts",
  "routes/scene-graph-ai.ts",
  "routes/social-publish.ts",
  "routes/suno.ts",
  "routes/three-d-title-ai.ts",
  "routes/web-scrape.ts",
  "routes/workflow-execution.ts",
  "routes/workflow-templates.ts",
])

/**
 * Same idea for admin imports. Admin code lives in `ee/routes/admin*` and
 * `lib/admin-check.ts` (which exports `checkIsAdmin` from core but the
 * heavy admin route handlers live in ee/).
 */
const NO_GATE_REQUIRED_FOR_ADMIN_IMPORT: ReadonlySet<string> = new Set<string>([
  "app.ts",
  "server.ts",
])

function reportPath(absolute: string): string {
  return absolute.slice(BACKEND_SRC.length + 1)
}

// ---------------------------------------------------------------------------
// Sanity check
// ---------------------------------------------------------------------------

describe("backend/src walk sanity", () => {
  it("found at least 100 non-ee TypeScript files", () => {
    expect(ALL_FILES.length).toBeGreaterThanOrEqual(100)
  })
})

// ---------------------------------------------------------------------------
// Test 1 — files importing from ee/billing/ also import hasCredits.
// ---------------------------------------------------------------------------

describe("ee/billing imports require hasCredits gate", () => {
  const offenders: Array<{ file: string; eeImports: string[] }> = []
  for (const path of ALL_FILES) {
    const rel = reportPath(path)
    if (NO_GATE_REQUIRED_FOR_BILLING_IMPORT.has(rel)) continue
    const src = readFileSync(path, "utf8")
    // Match `from "...ee/billing..."` or `from "@/ee/billing..."`
    const eeBillingMatches = [
      ...src.matchAll(
        /from\s+["']([^"']*ee\/billing\/[^"']+)["']/g,
      ),
    ].map((m) => m[1])
    if (eeBillingMatches.length === 0) continue
    // Must also import `hasCredits` from `lib/config`
    const importsHasCredits =
      /import\s*\{[^}]*\bhasCredits\b[^}]*\}\s*from\s*["'][^"']*lib\/config[^"']*["']/.test(
        src,
      )
    if (!importsHasCredits) {
      offenders.push({ file: rel, eeImports: eeBillingMatches })
    }
  }

  it("every non-shim file with ee/billing imports also imports hasCredits", () => {
    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `These files import from ee/billing/ without also importing \`hasCredits\` from lib/config — the credit code may be loaded in non-cloud editions, where it crashes at first call due to missing supabase tables (subscription_credits, topup_credits, etc.). Either:\n  (a) Add \`import { hasCredits } from "../lib/config.js"\` and gate the credit calls (preferred), or\n  (b) Move the file to ee/ if it's enterprise-only, or\n  (c) Add to NO_GATE_REQUIRED_FOR_BILLING_IMPORT in this test with explanation.\n\n${offenders
            .map((o) => `  • ${o.file}: imports ${o.eeImports.join(", ")}`)
            .join("\n")}`,
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Test 2 — files importing from ee/routes/admin* or using `requireAdmin`
// also import hasAdmin.
// ---------------------------------------------------------------------------

describe("admin route imports require hasAdmin gate", () => {
  const offenders: Array<{ file: string; trigger: string }> = []
  for (const path of ALL_FILES) {
    const rel = reportPath(path)
    if (NO_GATE_REQUIRED_FOR_ADMIN_IMPORT.has(rel)) continue
    const src = readFileSync(path, "utf8")
    // ee/admin import
    const adminEEImport = /from\s+["'][^"']*ee\/(?:routes\/admin|admin)[^"']*["']/.test(src)
    // Direct requireAdmin import (signal that admin gating is in play)
    const requireAdminImport = /\brequireAdmin\b/.test(src)
    if (!adminEEImport && !requireAdminImport) continue
    const importsHasAdmin =
      /import\s*\{[^}]*\bhasAdmin\b[^}]*\}\s*from\s*["'][^"']*lib\/config[^"']*["']/.test(
        src,
      )
    if (!importsHasAdmin) {
      offenders.push({
        file: rel,
        trigger: adminEEImport ? "ee/admin import" : "requireAdmin reference",
      })
    }
  }

  it("every non-shim file using admin code also imports hasAdmin", () => {
    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `These files use admin code without also importing \`hasAdmin\` from lib/config — admin paths may load in Community edition where the admin tables don't exist. Either gate behind \`hasAdmin()\`, move to ee/, or add to NO_GATE_REQUIRED_FOR_ADMIN_IMPORT.\n\n${offenders
            .map((o) => `  • ${o.file} (${o.trigger})`)
            .join("\n")}`,
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Test 3 — allowlist integrity.
// ---------------------------------------------------------------------------

describe("edition-gate allowlist integrity", () => {
  it("every NO_GATE_REQUIRED_FOR_BILLING_IMPORT entry is a real file", () => {
    const stale: string[] = []
    for (const rel of NO_GATE_REQUIRED_FOR_BILLING_IMPORT) {
      const abs = join(BACKEND_SRC, rel)
      try {
        if (!statSync(abs).isFile()) stale.push(rel)
      } catch {
        stale.push(rel)
      }
    }
    expect(
      stale,
      `These NO_GATE_REQUIRED_FOR_BILLING_IMPORT entries don't exist on disk — remove from allowlist: ${stale.join(", ")}`,
    ).toEqual([])
  })

  it("every NO_GATE_REQUIRED_FOR_ADMIN_IMPORT entry is a real file", () => {
    const stale: string[] = []
    for (const rel of NO_GATE_REQUIRED_FOR_ADMIN_IMPORT) {
      const abs = join(BACKEND_SRC, rel)
      try {
        if (!statSync(abs).isFile()) stale.push(rel)
      } catch {
        stale.push(rel)
      }
    }
    expect(
      stale,
      `These NO_GATE_REQUIRED_FOR_ADMIN_IMPORT entries don't exist on disk — remove from allowlist: ${stale.join(", ")}`,
    ).toEqual([])
  })
})
