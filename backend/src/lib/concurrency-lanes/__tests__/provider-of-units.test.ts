// A node unit's provider attribution (lib/concurrency-lanes/provider-of.ts,
// through lib/unit-descriptors.ts providerOf): a worker in the provider lane
// names the provider it calls (`provider:kie`), and its job counts against that
// provider's ceiling with no row naming it. The unit is fixture-echo's expected
// descriptor moved to the provider lane, added through the server's one door
// to the unit descriptors.
// @test-watches tools/units/__fixtures__/expected/backend/src/nodes/fixture-echo/** frontend/src/nodes/** backend/src/nodes/**
import { describe, expect, it, vi } from "vitest"

const KIE_UNIT = vi.hoisted(() => "fixture-kie")

vi.mock("../../unit-descriptors.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../unit-descriptors.js")>()
  const { unitProviderOf } = await import("../../unit-compose.js")
  const { isLeafLane } = await import("../leaf-lanes.js")
  const { descriptor } = await import("../../../../../tools/units/__fixtures__/expected/backend/src/nodes/fixture-echo/descriptor.generated.js")
  type Unit = (typeof real.UNIT_NODE_DESCRIPTORS)[number]
  const kie = { ...descriptor, type: KIE_UNIT, label: "Fixture KIE", capabilities: ["lane:provider", "provider:kie"] } as unknown as Unit
  const units = [...real.UNIT_NODE_DESCRIPTORS, kie]
  const unitDescriptorOf = (t: string | undefined) => units.find((u) => u.type === t)
  // The real laneOf's rule (its one lane:* capability, within the closed list), over this collection.
  const laneOf = (t: string | undefined) => {
    const lane = unitDescriptorOf(t)?.capabilities.find((c) => c.startsWith("lane:"))?.slice("lane:".length)
    return isLeafLane(lane) ? lane : undefined
  }
  return { ...real, UNIT_NODE_DESCRIPTORS: units, unitDescriptorOf, laneOf, providerOf: (t: string | undefined) => unitProviderOf(unitDescriptorOf(t)) }
})

const { JOB_LANE_CLASSES, laneClassOf } = await import("../registry.js")
const { UNIT_NODE_DESCRIPTORS, laneOf, providerOf } = await import("../../unit-descriptors.js")
const { HANDLER_PROVIDERS, ROUTED_JOBS, UNATTRIBUTED, primaryProviderOfJob } = await import("../provider-of.js")

describe("a node unit's provider attribution", () => {
  it("providerOf: the provider its provider:* capability names; none for a legacy or unknown type", () => {
    expect(providerOf(KIE_UNIT)).toBe("kie")
    expect(providerOf("generate-image")).toBeUndefined()
    expect(providerOf(undefined)).toBeUndefined()
  })

  it("its job is a provider-lane leaf (laneOf) and counts against that provider", () => {
    const cls = laneClassOf("video-generation", KIE_UNIT, {})
    expect(cls).toEqual({ kind: "leaf", lane: "provider" })
    expect(primaryProviderOfJob(KIE_UNIT, {})).toBe("kie")
  })

  it("HANDLER_PROVIDERS composes it beside the core handlers, frozen, every core row kept", () => {
    expect(HANDLER_PROVIDERS[KIE_UNIT]).toBe("kie")
    expect(Object.isFrozen(HANDLER_PROVIDERS)).toBe(true)
    expect(HANDLER_PROVIDERS["text-to-speech"]).toBe("elevenlabs")
    expect(primaryProviderOfJob("audio-isolation", {})).toBe("kie")
  })

  it("every provider-lane job (registry table and node units) is attributed, or unattributed with a reason, exactly once — the unit included", () => {
    const providerJobs = [
      ...Object.entries(JOB_LANE_CLASSES)
        .filter(([, cls]) => cls.kind === "leaf" && cls.lane === "provider")
        .map(([key]) => key.slice(key.indexOf(":") + 1)),
      ...UNIT_NODE_DESCRIPTORS.map((d) => d.type).filter((type) => laneOf(type) === "provider"),
    ]
    expect(providerJobs).toContain(KIE_UNIT)
    const tables = [HANDLER_PROVIDERS, ROUTED_JOBS, UNATTRIBUTED].map((t) => new Set(Object.keys(t)))
    const missing = providerJobs.filter((name) => !tables.some((t) => t.has(name)))
    const twice = providerJobs.filter((name) => tables.filter((t) => t.has(name)).length > 1)
    expect({ missing, twice }).toEqual({ missing: [], twice: [] })
  })
})
