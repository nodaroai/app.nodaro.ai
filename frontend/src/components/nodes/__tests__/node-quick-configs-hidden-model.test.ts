/**
 * A model the deployment does not offer (the profile, the admin override, or
 * the admin's switch on the model's pricing row — all one fetched set,
 * lib/surface-availability.ts) is hidden from every quick-strip model menu,
 * while a saved node that still holds it is NOT silently moved to the first
 * listed model: the value stays, labelled, and the run says why it is refused.
 */
import { describe, it, expect, afterEach } from "vitest"
import { __resetSurfaceAvailabilityForTests } from "@/lib/surface-availability"
import {
  allQuickConfigOptions,
  getQuickConfigs,
  quickConfigSnapPatch,
  resolveQuickConfigOptions,
  type QuickConfigControl,
} from "../node-quick-configs"

afterEach(() => __resetSurfaceAvailabilityForTests(null))

function providerControlOf(type: string): QuickConfigControl {
  const control = getQuickConfigs(type).find((c) => c.field === "provider")
  if (!control) throw new Error(`${type} has no provider control`)
  return control
}

describe("quick-strip model menus and the deployment's model availability", () => {
  it("a denied model is dropped from the menu, and nothing else", () => {
    const control = providerControlOf("lip-sync")
    const before = resolveQuickConfigOptions(control, {}).map((o) => o.value)
    expect(before).toContain("infinitalk")

    __resetSurfaceAvailabilityForTests({ nodes: [], models: ["infinitalk"] })
    const after = resolveQuickConfigOptions(control, {}).map((o) => o.value)
    expect(after).not.toContain("infinitalk")
    expect(after).toEqual(before.filter((v) => v !== "infinitalk"))
    // The full declaration is still readable, for the pill's label.
    expect(allQuickConfigOptions(control, {}).map((o) => o.value)).toEqual(before)
  })

  it("a node holding a hidden model is NOT snapped to the first listed model", () => {
    const control = providerControlOf("lip-sync")
    __resetSurfaceAvailabilityForTests({ nodes: [], models: ["infinitalk"] })
    const options = resolveQuickConfigOptions(control, { provider: "infinitalk" })
    expect(quickConfigSnapPatch(control, "infinitalk", options, { provider: "infinitalk" })).toBeUndefined()
    // A value the control never declared still snaps, as before.
    expect(quickConfigSnapPatch(control, "no-such-model", options, { provider: "no-such-model" })).toEqual({ provider: options[0]!.value })
  })

  it("a node holding the ONLY model of a one-model menu keeps it when that model is hidden", () => {
    const control: QuickConfigControl = {
      field: "provider",
      ariaLabel: "Model",
      options: [{ value: "only-model", label: "Only" }],
    }
    __resetSurfaceAvailabilityForTests({ nodes: [], models: ["only-model"] })
    const options = resolveQuickConfigOptions(control, { provider: "only-model" })
    expect(options).toEqual([])
    // Not cleared: the empty-list branch must not run before the hidden-model rule.
    expect(quickConfigSnapPatch(control, "only-model", options, { provider: "only-model" })).toBeUndefined()
  })

  it("a control that lists no models is untouched by the availability set", () => {
    const control = getQuickConfigs("lip-sync").find((c) => c.field !== "provider")
    if (!control) return
    __resetSurfaceAvailabilityForTests({ nodes: [], models: ["infinitalk"] })
    expect(resolveQuickConfigOptions(control, { provider: "kling-avatar" })).toEqual(allQuickConfigOptions(control, { provider: "kling-avatar" }))
  })
})
