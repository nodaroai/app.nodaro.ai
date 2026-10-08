import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

/**
 * No price path may read the old default. A video request with no duration is
 * charged at the model's catalog `defaultDuration` through ONE funnel
 * (`pricedOutputDurationSec` in @nodaro/shared); a hand-written `duration ?? 5`
 * (or `?? 8`) beside a price re-opens the under/over-charge that funnel closed,
 * and the retired `PRICING_DEFAULT_DURATION_SEC` map is only a derived export.
 *
 * File-keyed, like job-policy-result-totality: it scans the files below for a
 * numeric duration fallback and everything for the retired map. A file that
 * legitimately keeps a non-model default (its own product length) is listed in
 * EXEMPT with the reason — the list is the source of truth, not prose.
 */
const ROOT = resolve(__dirname, "../../../..")
const PRICE_FILES = [
  "packages/shared/src/credit-identifiers.ts",
  "packages/shared/src/model-constants.ts",
  "packages/shared/src/credit-estimators",
  "backend/src/lib/seedance-extend-model.ts",
  "backend/src/lib/reconcile/loop-trim-refund.ts",
  "backend/src/lib/loop-trim-addon.ts",
  "backend/src/workers/handlers/video-ai.ts",
  "backend/src/lib/video-request-norm.ts",
  "backend/src/lib/generated-video-length.ts",
  "backend/src/ee/billing/credits.ts",
  "backend/src/ee/billing/seedance2-ref-video-credits.ts",
  "backend/src/routes/generate-video.ts",
  "backend/src/routes/text-to-video.ts",
  "backend/src/ee/pipelines/services/pipeline-extend-video.ts",
  "frontend/src/components/editor/config-panels/helpers.ts",
  "frontend/src/components/nodes/generate-video-node.tsx",
]
/** file → lines (trimmed) that keep a numeric duration fallback, and why. */
const EXEMPT: Record<string, string[]> = {
  // Transitions/fades are effect lengths in seconds, not a video model's render length.
  "packages/shared/src/credit-estimators": ["transitionDuration ?? 0.5"],
  "backend/src/ee/billing/credits.ts": [],
}
// `duration ?? 5`, `duration || 5` AND the ternary spelling
// `typeof b.duration === "number" ? b.duration : 8`.
const FALLBACK = /\bduration[A-Za-z]*\)?\s*(\?\?|\|\|)\s*\d|\bduration[^?:\n]*\?[^:\n]*:\s*\d/

function walk(p: string): string[] {
  const abs = join(ROOT, p)
  if (statSync(abs).isDirectory()) {
    return readdirSync(abs).flatMap((f) => (f === "__tests__" ? [] : walk(join(p, f))))
  }
  return /\.(ts|tsx)$/.test(p) ? [p] : []
}

describe("pricing paths never read the old default duration", () => {
  it("no price file carries a numeric duration fallback", () => {
    const offenders: string[] = []
    for (const root of PRICE_FILES) {
      for (const file of walk(root)) {
        const allowed = EXEMPT[root] ?? []
        readFileSync(join(ROOT, file), "utf8").split("\n").forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, "")
          if (FALLBACK.test(code) && !allowed.some((a) => code.includes(a))) {
            offenders.push(`${file}:${i + 1}: ${line.trim()}`)
          }
        })
      }
    }
    expect(offenders, "route the default through pricedOutputDurationSec / the catalog's defaultDuration").toEqual([])
  })

  it("nothing reads the retired PRICING_DEFAULT_DURATION_SEC map", () => {
    const allowed = new Set([
      "packages/shared/src/model-constants.ts", // the derived, deprecated export
      "packages/shared/src/index.ts", // its re-export
    ])
    const offenders: string[] = []
    const scan = (dir: string): void => {
      for (const f of readdirSync(join(ROOT, dir))) {
        if (f === "node_modules" || f === "dist" || f === "__tests__" || f.startsWith(".")) continue
        const rel = join(dir, f)
        const abs = join(ROOT, rel)
        if (statSync(abs).isDirectory()) scan(rel)
        else if (/\.(ts|tsx)$/.test(f) && !allowed.has(relative("", rel)) && readFileSync(abs, "utf8").includes("PRICING_DEFAULT_DURATION_SEC")) {
          offenders.push(rel)
        }
      }
    }
    for (const d of ["packages/shared/src", "packages/prompts/src", "backend/src", "frontend/src"]) scan(d)
    expect(offenders).toEqual([])
  })
})
