// @test-watches frontend/src/components/editor/workflow-editor/types.ts
/**
 * The editor's cold-cache credit table must agree with the price table.
 *
 * `NODE_CREDIT_COSTS` in
 * `frontend/src/components/editor/workflow-editor/types.ts` is the fallback
 * every client-side quote uses while the live model-cost cache is cold: the
 * canvas node badges, the canvas total, the Run button and the pre-run confirm
 * dialog. It is a SECOND COPY of prices whose authority is `model_pricing`,
 * with `STATIC_CREDIT_COSTS` as the runtime fallback — so it drifts silently,
 * and when it drifts the user is quoted a number the run will not cost.
 *
 * It drifted exactly that way through the 2026-07-30 ×10 credit
 * re-denomination: the migration swept `STATIC_CREDIT_COSTS`, `model_pricing`,
 * `MODEL_CATALOG` and the video-analysis table and never touched that file, so
 * every fallback quoted a tenth of the real price and nothing failed.
 *
 * `frontend/…/__tests__/credit-estimate-tables.test.ts` pins the part a
 * frontend test can reach — the overlap with `MODEL_CATALOG`, which prices
 * MODELS. The node-type and composite rows (`add-captions:kinetic`,
 * `speed-ramp`, `image-collage`, …) have no catalog entry, and
 * `STATIC_CREDIT_COSTS` lives in `ee/` where the frontend cannot import it. So
 * the pin for those lives HERE, reading the table out of the frontend source —
 * the same shape as `docs-node-registry-parity.test.ts` reading `docs/`.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { STATIC_CREDIT_COSTS } from "../../ee/billing/credits.js"

const REPO_ROOT = join(__dirname, "..", "..", "..", "..")
const TYPES_PATH = join(
  REPO_ROOT,
  "frontend/src/components/editor/workflow-editor/types.ts",
)

/**
 * Keys with no `STATIC_CREDIT_COSTS` row, and why. Each is a display-only
 * fallback for a node whose real identifier is a DIFFERENT row, so there is
 * nothing to compare against — never a licence to invent a number: each one
 * over-quotes rather than under-quotes, which is the direction a display
 * estimate is allowed to be wrong in.
 */
const NO_STATIC_ROW: Readonly<Record<string, string>> = {
  // Reserves on `roop-face-swap`; this key is the node-type display floor.
  "face-swap": "priced under roop-face-swap",
  // LLM authoring only; reserves on `3d-scene[:tier]`, and the MP4 is billed by
  // the downstream render-video node.
  "generate-3d-scene": "priced under 3d-scene[:tier]",
  "edit-3d-scene": "priced under 3d-scene-ops / 3d-scene[:tier]",
}

/**
 * Parse the flat `NODE_CREDIT_COSTS` literal out of the frontend module.
 *
 * Deliberately textual: importing the module would drag React, Zustand, the
 * `@/` path alias and the `ee/` model-cost hook into a backend test run. The
 * table is a plain `"key": number,` object literal, and the sanity floor below
 * fails the test if this parse ever stops finding it.
 */
function parseNodeCreditCosts(): Map<string, number> {
  const src = readFileSync(TYPES_PATH, "utf8")
  const start = src.indexOf("export const NODE_CREDIT_COSTS")
  expect(start, `NODE_CREDIT_COSTS not found in ${TYPES_PATH}`).toBeGreaterThan(-1)
  const body = src.slice(start)
  const end = body.indexOf("\n};")
  expect(end, "could not find the end of the NODE_CREDIT_COSTS literal").toBeGreaterThan(-1)
  const table = body.slice(0, end)
  const out = new Map<string, number>()
  const row = /^\s*"([^"]+)":\s*(-?\d+)\s*,/gm
  let match: RegExpExecArray | null
  while ((match = row.exec(table)) !== null) out.set(match[1]!, Number(match[2]!))
  return out
}

const FALLBACKS = parseNodeCreditCosts()

describe("editor cold-cache credit fallbacks track STATIC_CREDIT_COSTS", () => {
  it("parsed a non-trivial table (the sanity floor)", () => {
    // A parse that quietly starts matching nothing would make every assertion
    // below vacuous — the exact failure mode this whole test exists to prevent.
    expect(FALLBACKS.size).toBeGreaterThanOrEqual(90)
  })

  it("every fallback that STATIC_CREDIT_COSTS also prices agrees with it", () => {
    const drifted: string[] = []
    let compared = 0
    for (const [id, credits] of FALLBACKS) {
      const authoritative = STATIC_CREDIT_COSTS[id]
      if (authoritative === undefined) continue
      if (authoritative !== credits) {
        drifted.push(`${id}: editor fallback ${credits}, STATIC_CREDIT_COSTS ${authoritative}`)
      }
      compared++
    }
    expect(compared, "no keys were compared — the parse or the table shape broke").toBeGreaterThan(80)
    expect(
      drifted,
      "the editor would quote these prices while the run reserves a different number — " +
        "copy the STATIC_CREDIT_COSTS value into NODE_CREDIT_COSTS, never scale the old one",
    ).toEqual([])
  })

  it("every fallback WITHOUT a price-table row is a documented exception", () => {
    const undocumented = [...FALLBACKS.keys()].filter(
      (id) => STATIC_CREDIT_COSTS[id] === undefined && NO_STATIC_ROW[id] === undefined,
    )
    expect(
      undocumented,
      "these editor fallbacks name no priced identifier — either use the id the node really " +
        "reserves on, or record why it has no row in NO_STATIC_ROW",
    ).toEqual([])
  })

  it("the documented exceptions have not silently gained a row", () => {
    // Keeps the allowlist from rotting: the day a node-type row is seeded, the
    // entry must go so the parity check starts covering it.
    for (const id of Object.keys(NO_STATIC_ROW)) {
      expect(
        STATIC_CREDIT_COSTS[id],
        `STATIC_CREDIT_COSTS now prices "${id}" — drop it from NO_STATIC_ROW so the parity check covers it`,
      ).toBeUndefined()
    }
  })

  it("prices BOTH add-captions renderers, matching the price table exactly", () => {
    // The pair the run actually reserves on: `add-captions` is the cheap FFmpeg
    // drawtext burn, `add-captions:kinetic` the Remotion render anything styled
    // / timed / transcribed / segmented needs. `estimateRunCredits` resolves the
    // composite first, so a missing or stale kinetic row under-quotes every
    // Remotion caption run while the cache is cold.
    for (const id of ["add-captions", "add-captions:kinetic"]) {
      expect(FALLBACKS.get(id), `NODE_CREDIT_COSTS is missing "${id}"`).toBe(
        STATIC_CREDIT_COSTS[id],
      )
    }
  })
})
