/**
 * W3 regression net (spec 2026-09-01-app-reports-triage-design.md §5).
 *
 * `ModelSelectOption` prices a row by `creditId ?? value`
 * (model-select-option.tsx:36). The Suno selects' `value` is a bare Suno
 * VERSION ("V5_5", "V4_5ALL", ...), which is not a credit key anywhere — so
 * without a `creditId` every one of them asks
 * GET /v1/credits/model-cost?model=V5_5, the route 503s
 * `price_not_configured`, and the dropdown renders NO price at all
 * (formatCreditBadge returns undefined on 0 credits). That produced 96
 * `price-not-configured` app-report rows over six weeks.
 *
 * Radix mounts SelectContent children into a detached fragment while closed,
 * so these lookups fire when the node's CONFIG PANEL renders — not when the
 * user opens the dropdown. There is no cheap render assertion; this scans the
 * source for the prop instead.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { SUNO_VERSION_PRICED_OPERATIONS, SUNO_SELECT_OPERATIONS } from "@nodaro/shared"

const SRC = readFileSync(resolve(__dirname, "../audio-configs.tsx"), "utf8")

/** Every Suno model dropdown: the `.map((m) => (<ModelSelectOption ... />))` body. */
const SUNO_OPTION_RE =
  /(SUNO_MODELS|SUNO_ADD_TRACK_MODEL_OPTIONS)\.map\(\(m\) => \(\s*<ModelSelectOption([\s\S]{0,400}?)\/>/g

/** The operation string inside `creditId={sunoCreditType(m.value, "<op>")}`. */
const CREDIT_ID_RE = /creditId=\{sunoCreditType\(m\.value,\s*"([a-z0-9-]+)"\)\}/

function sunoSelectOperations(): string[] {
  const ops: string[] = []
  for (const match of SRC.matchAll(SUNO_OPTION_RE)) {
    const attrs = match[2] ?? ""
    const creditId = attrs.match(CREDIT_ID_RE)
    expect(
      creditId,
      `A Suno <ModelSelectOption> renders with no creditId={sunoCreditType(m.value, "<operation>")}. ` +
        `It will price the row by the bare Suno version and 503. Offending source:\n${match[0]}`,
    ).not.toBeNull()
    ops.push(creditId![1]!)
  }
  return ops
}

describe("Suno model dropdowns price by the route's credit key, never the bare version", () => {
  it("finds all seven Suno model selects", () => {
    expect(sunoSelectOperations()).toHaveLength(SUNO_SELECT_OPERATIONS.length)
  })

  it("each select declares the operation its route actually charges", () => {
    // audio-configs.tsx source order: generate, cover, extend, mashup,
    // add-instrumental, add-vocals, upload-extend.
    expect([...sunoSelectOperations()].sort()).toEqual([...SUNO_SELECT_OPERATIONS].sort())
  })

  it("the three version-priced operations are all represented", () => {
    const ops = new Set(sunoSelectOperations())
    for (const op of SUNO_VERSION_PRICED_OPERATIONS) {
      expect(ops.has(op), `no Suno select declares the version-priced operation ${op}`).toBe(true)
    }
  })
})

/**
 * Task 5 (same spec, §5): the three Suno node badges hand-rolled a V5-only
 * version map plus a pre-redenomination 13/7 numeric fallback. Both must be
 * gone, replaced with `useModelCredits(sunoCreditType(nodeData.model, "<op>"))`
 * — the exact identifier the route reserves with — and NO second argument to
 * `useModelCredits` (a numeric fallback is how the stale rate crept back in).
 */
const NODE_DIR = resolve(__dirname, "../../../nodes")
const BADGES: ReadonlyArray<{ file: string; op: string }> = [
  { file: "suno-generate-node.tsx", op: "suno-generate" },
  { file: "suno-cover-node.tsx", op: "suno-cover" },
  { file: "suno-extend-node.tsx", op: "suno-extend" },
]

describe("Suno node badges price by the route's credit key, no numeric fallback", () => {
  it.each(BADGES)("$file reads useModelCredits(sunoCreditType(nodeData.model, $op)) with no fallback arg", ({ file, op }) => {
    const src = readFileSync(resolve(NODE_DIR, file), "utf8")
    const callRe = new RegExp(`useModelCredits\\(sunoCreditType\\(nodeData\\.model,\\s*"${op}"\\)\\)`)
    const creditLines = src.split("\n").filter((l) => l.includes("useModelCredits(")).join("\n")
    expect(
      callRe.test(src),
      `${file} must read credits as useModelCredits(sunoCreditType(nodeData.model, "${op}")) — ` +
        `no numeric fallback argument, no hand-rolled version map. Found:\n${creditLines || "(no useModelCredits call found)"}`,
    ).toBe(true)
    expect(src, `${file} still has a hand-rolled "creditModel" local`).not.toMatch(/\bcreditModel\b/)
  })
})
