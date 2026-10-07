import { describe, expect, it, vi } from "vitest"
import { buildLlmCreditIdentifier } from "@nodaro/shared"

const flag = vi.hoisted(() => ({ on: false }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, speechLengthPricingEnabled: () => flag.on }
})
import { deploymentPriceDefinitions, resolveDeploymentPrices } from "../deployment-pricing.js"

describe("deployment pricing identifiers", () => {
  it.each(["gemini-3-flash", "gemini-3.6-flash", "claude-haiku-4.5", "claude-sonnet-5", "gpt-5.5"])("prices %s through charged operations, not its bare catalog ID", async id => {
    const price = vi.fn(async (key: string) => { if (key === id) throw new Error("unpriced bare model"); return 17 })
    const resolved = await resolveDeploymentPrices([id], price)
    const definition = resolved.definitions.get(id)!
    expect(definition.baseIdentifier).toBe(buildLlmCreditIdentifier("llm-chat", id))
    expect(definition.variants).toContainEqual(expect.objectContaining({ operation: "ai-writer", identifier: buildLlmCreditIdentifier("ai-writer", id) }))
    expect(price).not.toHaveBeenCalledWith(id)
    expect(resolved.prices.get(definition.baseIdentifier)).toEqual({ status: "fulfilled", value: 17 })
  })
  it("resolves media variants through effective prices and deduplicates reads", async () => {
    const definitions = deploymentPriceDefinitions("nano-banana-pro")
    expect(definitions.variants.length).toBeGreaterThan(1)
    const price = vi.fn(async () => 123)
    const resolved = await resolveDeploymentPrices(["nano-banana-pro", "nano-banana-pro"], price)
    expect(price).toHaveBeenCalledTimes(resolved.identifiers.length)
    for (const row of resolved.prices.values()) expect(row).toEqual({ status: "fulfilled", value: 123 })
  })
  it("isolates a missing variant instead of substituting static catalog prices", async () => {
    const resolved = await resolveDeploymentPrices(["nano-banana-pro"], async () => { throw new Error("missing") })
    for (const row of resolved.prices.values()) expect(row.status).toBe("rejected")
  })
})

describe("deployment pricing of a speech model", () => {
  const SPEECH = ["elevenlabs-v3", "elevenlabs-v4", "elevenlabs-turbo", "elevenlabs-multilingual", "elevenlabs-dialogue", "elevenlabs-dialogue-v4"]

  it("lists no per-100-characters row while length pricing is off: the price list is today's, with no price_not_configured entry", () => {
    flag.on = false
    for (const id of SPEECH) {
      const identifiers = deploymentPriceDefinitions(id).variants.map((v) => v.identifier)
      expect(identifiers, id).toEqual([id])
    }
  })

  it("lists the row while it is on", () => {
    flag.on = true
    for (const id of SPEECH) {
      const identifiers = deploymentPriceDefinitions(id).variants.map((v) => v.identifier)
      expect(identifiers, id).toEqual([id, `${id}:per-100-chars`])
    }
    flag.on = false
  })
})

