import { describe, it, expect, beforeEach } from "vitest"
import { getParameterPromptHint } from "../parameter-prompt-hint.js"
import { registerCatalogPack, resetCatalogPacks } from "../catalog-packs.js"

beforeEach(() => resetCatalogPacks())

// NOTE: getParameterPromptHint reads picker fields from node.data (see the
// existing parameter-prompt-hint.test.ts convention `{ id, type, data: {...} }`).
describe("pack-extend promptHint fallback (single-dim)", () => {
  it("base ids resolve exactly as before", () => {
    // 'forest' is a base 'setting' id; its hint is unchanged.
    expect(getParameterPromptHint({ id: "n1", type: "setting", data: { setting: "forest" } })).toBeTypeOf("string")
  })

  it("a pack-added single-dim id resolves to the pack option promptHint", () => {
    registerCatalogPack({ id: "sai/setting", catalogId: "setting", mode: "extend",
      options: [{ id: "shul-hall", label: "Shul Hall", promptHint: "in a synagogue hall" }] })
    expect(getParameterPromptHint({ id: "n1", type: "setting", data: { setting: "shul-hall" } }))
      .toBe("in a synagogue hall")
  })

  it("an unknown id still yields empty string", () => {
    expect(getParameterPromptHint({ id: "n1", type: "setting", data: { setting: "does-not-exist" } })).toBe("")
  })
})
