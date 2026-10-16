// @test-watches frontend/src/types/nodes.ts
/**
 * Input and parameter nodes are free — writing text, uploading a file or
 * picking a camera angle never costs credits.
 *
 * This rule used to be checked against the hand-typed `creditCost` on the
 * frontend `NODE_DEFINITIONS`, a number nothing charges from (it was removed,
 * see `frontend/src/types/__tests__/node-definitions-no-credit-cost.test.ts`).
 * It is checked here against what the backend actually prices from:
 *
 *  - the price-table row for the node type (`STATIC_CREDIT_COSTS`, which the
 *    migrations seed into `model_pricing` and the credit guard falls back to), and
 *  - the `NODE_REGISTRY` figure `GET /v1/nodes` advertises.
 *
 * Which nodes are "input" / "parameter" is the editor's classification (the
 * category on `NODE_DEFINITIONS`, read through the gen-skills parser) joined
 * with the backend registry's own category, so a node either side files under
 * those categories is covered.
 */
import { describe, it, expect } from "vitest"
import { resolve } from "node:path"
import { parseNodeDefinitions } from "../../../scripts/lib/gen-skills/parse-node-definitions.js"
import { STATIC_CREDIT_COSTS } from "../../ee/billing/credits.js"
import { NODE_REGISTRY } from "../node-registry.js"

const NODES_TS = resolve(__dirname, "../../../../frontend/src/types/nodes.ts")
const EDITOR_DEFS = parseNodeDefinitions(NODES_TS)

/**
 * Input / parameter nodes that are paid because they make a network or
 * provider call rather than emit a local value:
 *   web-scrape — Apify network call
 *   suno-voice — Suno voice-create call (paid once in the modal flow)
 *   telegram-channel-feed — fetches + parses a public channel's posts
 *   meta-ads-scrape — Apify network call (Meta Ad Library), tiered per ad
 *   instagram-scrape — Apify network call
 *   social-search — a platform search through the cloud plugin, per page
 *   site-capture — a phone browser loads the page and shoots its sections
 */
const PAID_INPUT_EXCEPTIONS = new Set([
  "web-scrape",
  "suno-voice",
  "telegram-channel-feed",
  "meta-ads-scrape",
  "instagram-scrape",
  "social-search",
  "site-capture",
])

const FREE_CATEGORIES = new Set(["input", "parameter"])

function freeNodeTypes(): string[] {
  const editor = EDITOR_DEFS.filter((d) => FREE_CATEGORIES.has(d.category)).map((d) => d.type)
  const backend = NODE_REGISTRY.filter((d) => FREE_CATEGORIES.has(d.category)).map((d) => d.type)
  return [...new Set([...editor, ...backend])].filter((t) => !PAID_INPUT_EXCEPTIONS.has(t)).sort()
}

const isFree = (cost: number | string | undefined) => cost === undefined || cost === 0

describe("input and parameter nodes cost nothing", () => {
  const types = freeNodeTypes()

  it("finds the input and parameter nodes", () => {
    expect(types.length).toBeGreaterThanOrEqual(40)
    expect(types).toContain("text-prompt")
  })

  it("no input / parameter node has a price-table row above 0", () => {
    const priced = types.filter((t) => !isFree(STATIC_CREDIT_COSTS[t])).map((t) => `${t} = ${STATIC_CREDIT_COSTS[t]}`)
    expect(
      priced,
      "an input / parameter node is priced in STATIC_CREDIT_COSTS (backend/src/ee/billing/credits.ts). " +
        "If it really makes a paid call, add it to PAID_INPUT_EXCEPTIONS here with the reason; otherwise drop the row.",
    ).toEqual([])
  })

  it("no input / parameter node advertises a credit cost on GET /v1/nodes", () => {
    const priced = NODE_REGISTRY.filter((d) => types.includes(d.type) && !isFree(d.creditCost)).map((d) => `${d.type} = ${d.creditCost}`)
    expect(
      priced,
      "an input / parameter node declares a creditCost in NODE_REGISTRY (backend/src/lib/node-registry.ts). " +
        "If it really makes a paid call, add it to PAID_INPUT_EXCEPTIONS here with the reason; otherwise drop the figure.",
    ).toEqual([])
  })

  it("every exception is still an input / parameter node somewhere", () => {
    const editor = new Map(EDITOR_DEFS.map((d) => [d.type, d.category]))
    const backend = new Map(NODE_REGISTRY.map((d) => [d.type, d.category as string]))
    const stale = [...PAID_INPUT_EXCEPTIONS].filter(
      (t) => !FREE_CATEGORIES.has(editor.get(t) ?? "") && !FREE_CATEGORIES.has(backend.get(t) ?? ""),
    )
    expect(stale, "PAID_INPUT_EXCEPTIONS names a node that is no longer an input / parameter node — remove it").toEqual([])
  })
})
