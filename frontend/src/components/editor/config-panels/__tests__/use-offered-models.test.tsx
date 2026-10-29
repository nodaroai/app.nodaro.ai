/**
 * `useOfferedModels` / `withoutDeniedModels`: a config-panel menu drops the
 * models the deployment does not offer, keeps the node's stored model (never
 * silently moved — the run refuses it with its own message), and follows an
 * admin's switch while the panel is open.
 */
import { describe, it, expect, afterEach } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { __resetSurfaceAvailabilityForTests } from "@/lib/surface-availability"
import { withoutDeniedModels } from "../model-options"
import { useOfferedModels } from "../use-offered-models"

const MODELS = [
  { value: "a-model", label: "A" },
  { value: "b-model", label: "B" },
  { value: "c-model", label: "C" },
] as const

afterEach(() => __resetSurfaceAvailabilityForTests(null))

describe("withoutDeniedModels", () => {
  it("drops a denied model, and keeps the node's stored one even when denied", () => {
    __resetSurfaceAvailabilityForTests({ nodes: [], models: ["b-model", "c-model"] })
    expect(withoutDeniedModels(MODELS).map((m) => m.value)).toEqual(["a-model"])
    expect(withoutDeniedModels(MODELS, "b-model").map((m) => m.value)).toEqual(["a-model", "b-model"])
    // A stored value that is not denied changes nothing.
    expect(withoutDeniedModels(MODELS, "a-model").map((m) => m.value)).toEqual(["a-model"])
  })
})

describe("useOfferedModels", () => {
  it("re-reads the list when availability changes, keeping the stored model", () => {
    const { result } = renderHook(() => useOfferedModels(MODELS, "c-model"))
    expect(result.current.map((m) => m.value)).toEqual(["a-model", "b-model", "c-model"])

    // An admin switches two models off: the menu follows at once; the node's
    // own (c-model) stays listed.
    act(() => __resetSurfaceAvailabilityForTests({ nodes: [], models: ["b-model", "c-model"] }))
    expect(result.current.map((m) => m.value)).toEqual(["a-model", "c-model"])

    // Switched back on: back in the menu.
    act(() => __resetSurfaceAvailabilityForTests({ nodes: [], models: [] }))
    expect(result.current.map((m) => m.value)).toEqual(["a-model", "b-model", "c-model"])
  })
})
