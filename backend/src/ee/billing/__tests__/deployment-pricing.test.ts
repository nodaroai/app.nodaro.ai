// @test-units-by-name names no node type: it prices LLM model ids and catalog models
import { describe, expect, it, vi } from "vitest"
import { LLM_FEATURE_DEFAULTS, buildLlmCreditIdentifier, llmPriceKey } from "@nodaro/shared/llm-models"
import { TIER_BILLED_LLM_FEATURES } from "@nodaro/render-rules"

const flag = vi.hoisted(() => ({ on: false }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, speechLengthPricingEnabled: () => flag.on }
})
import { deploymentPriceDefinitions, resolveDeploymentPrices } from "../deployment-pricing.js"
import { PriceNotConfiguredError, chargedPriceTableFrom, meteredLlmQuote } from "../credits.js"
import { setLlmMeteredSchemaReadyForTesting } from "../../../lib/llm-metered-schema-gate.js"

vi.mock("@/lib/supabase.js", () => {
  const query = { select: () => query, order: () => query, eq: () => query, range: async () => ({ data: [], error: null }) }
  return { supabase: { from: () => query } }
})
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => ({ cost_markup_percent: 10, service_margin_percent: {} }) }))

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
  const SPEECH = ["elevenlabs-v3", "elevenlabs-v4", "elevenlabs-v4-turbo", "elevenlabs-turbo", "elevenlabs-multilingual", "elevenlabs-dialogue", "elevenlabs-dialogue-v4"]

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


describe("deployment pricing of a text model under metered pricing (Task 12)", () => {
  const table = () => chargedPriceTableFrom(new Map(), { cost_markup_percent: 10 } as never)
  const estimateOf = (key: string) => {
    const q = meteredLlmQuote(table(), key)
    return q?.kind === "estimate" ? q.credits : undefined
  }

  it("lists each metered feature at its per-model estimate key, priced at the estimate — never through the bare lookup", async () => {
    setLlmMeteredSchemaReadyForTesting(true)
    try {
      const id = "claude-opus-5.5"
      const price = vi.fn(async () => 17)
      const resolved = await resolveDeploymentPrices([id], price)
      const definition = resolved.definitions.get(id)!
      expect(definition.baseIdentifier).toBe(llmPriceKey("llm-chat", id))
      expect(definition.variants).toContainEqual(expect.objectContaining({ operation: "ai-writer", identifier: llmPriceKey("ai-writer", id) }))
      // Choose Best's judge bills under its reduce feature.
      expect(definition.variants).toContainEqual(expect.objectContaining({ operation: "pick-best-llm", identifier: llmPriceKey("reduce:pick-best-llm", id) }))
      // Still on their tiers: Workflow Copilot (D4), Content Recipe / Ideas — and the embedded
      // translate step (inside a media node's fixed price, D3), never per model.
      for (const operation of [...TIER_BILLED_LLM_FEATURES, "translate"]) {
        expect(definition.variants, operation).toContainEqual(expect.objectContaining({ operation, identifier: buildLlmCreditIdentifier(operation, id) }))
        expect(definition.variants.find((v) => "operation" in v && v.operation === operation), operation).not.toHaveProperty("estimate")
      }
      expect(resolved.prices.get(definition.baseIdentifier)).toEqual({ status: "fulfilled", value: estimateOf(llmPriceKey("llm-chat", id)) })
      // A metered key never reaches the bare lookup (it would answer price_not_configured); a tier row still does.
      expect(price).not.toHaveBeenCalledWith(llmPriceKey("llm-chat", id))
      expect(price).toHaveBeenCalledWith(buildLlmCreditIdentifier("workflow-copilot", id))
    } finally {
      setLlmMeteredSchemaReadyForTesting(undefined)
    }
  })

  it("a model with no price on its lane is missing (price_not_configured), never 0", async () => {
    setLlmMeteredSchemaReadyForTesting(true)
    try {
      const resolved = await resolveDeploymentPrices(["claude-opus-5.5"], async () => 17)
      // Every metered key either an estimate or PriceNotConfiguredError — no 0.
      for (const [key, row] of resolved.prices) {
        if (row.status === "fulfilled") expect(row.value, key).toBeGreaterThan(0)
        else expect(row.reason, key).toBeInstanceOf(PriceNotConfiguredError)
      }
    } finally {
      setLlmMeteredSchemaReadyForTesting(undefined)
    }
  })

  it("rollback (metered pricing off): today's tier identifiers, byte for byte", () => {
    setLlmMeteredSchemaReadyForTesting(false)
    const id = "claude-opus-5.5"
    expect(deploymentPriceDefinitions(id)).toEqual({
      baseIdentifier: buildLlmCreditIdentifier("llm-chat", id),
      basis: "llm-chat-default-settings",
      variants: Object.keys(LLM_FEATURE_DEFAULTS).map((operation) => ({
        identifier: buildLlmCreditIdentifier(operation, id), operation, note: "Default reasoning and standard mode",
      })),
    })
    setLlmMeteredSchemaReadyForTesting(undefined)
  })
})
