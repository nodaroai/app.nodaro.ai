/**
 * Admin → Video route: a save states the setting its DRAFT was started from
 * (hooks/use-video-route-draft.ts), so the server's "changed since" refusal
 * cannot be bypassed by the page refreshing under an unsaved draft.
 */
import { describe, expect, it } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { policyChanges, useVideoRouteDraft } from "../use-video-route-draft"
import type { VideoRoutePolicy, VideoRouteView } from "@/ee/lib/video-route-api"

const policy = (models: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ models, ...extra }) as unknown as VideoRoutePolicy
const view = (updatedAt: string | null, p: VideoRoutePolicy, factorsUpdatedAt: string | null = null, factors: Record<string, { factor: number }> = {}) =>
  ({ updatedAt, policy: p, legacyRouting: null, factors, factorsUpdatedAt }) as unknown as VideoRouteView

const T0 = "2026-11-27T10:00:00.000Z"
const T1 = "2026-11-27T10:05:00.000Z"

describe("useVideoRouteDraft", () => {
  it("A edits, B saves, A acts on the page, A saves: the save still states the setting A's draft was started from", () => {
    const { result, rerender } = renderHook(({ data }) => useVideoRouteDraft(data), { initialProps: { data: view(T0, policy({ "seedance-2-5": { route: "default" } })) } })
    expect(result.current.baseUpdatedAt).toBe(T0)
    // A edits.
    const edited = policy({ "seedance-2-5": { route: "alternate" } })
    act(() => result.current.setDraft(edited))
    // B saves (T1); then A decides a hold, whose answer replaces the page's view with the T1 one.
    rerender({ data: view(T1, policy({ "seedance-2": { route: "alternate" } })) })
    // A's draft is kept, and what A would send is still T0: the server refuses it (409), B's save is not overwritten.
    expect(result.current.draft).toBe(edited)
    expect(result.current.baseUpdatedAt).toBe(T0)
    expect(result.current.staleChanges).toEqual(["the routing of seedance-2", "the routing of seedance-2-5"])
    // Reload: the draft follows the saved setting again, and a save from there states T1.
    act(() => result.current.reset())
    expect(result.current.draft).toEqual(policy({ "seedance-2": { route: "alternate" } }))
    expect(result.current.baseUpdatedAt).toBe(T1)
    expect(result.current.staleChanges).toEqual([])
  })

  it("an unedited page simply follows the newest view", () => {
    const { result, rerender } = renderHook(({ data }) => useVideoRouteDraft(data), { initialProps: { data: view(T0, policy()) } })
    rerender({ data: view(T1, policy({ "seedance-2": { route: "alternate" } })) })
    expect(result.current.baseUpdatedAt).toBe(T1)
    expect(result.current.draft).toEqual(policy({ "seedance-2": { route: "alternate" } }))
    expect(result.current.staleChanges).toEqual([])
  })

  it("the factors keep their own base: a table that changed under edited inputs is not saved over", () => {
    const { result, rerender } = renderHook(({ data }) => useVideoRouteDraft(data), { initialProps: { data: view(T0, policy(), T0, { k: { factor: 1.2 } }) } })
    expect(result.current.factors).toEqual({ k: "1.2" })
    act(() => result.current.setFactors({ k: "1" }))
    // An automatic raise lands, and another action refreshes the page.
    rerender({ data: view(T0, policy(), T1, { k: { factor: 1.5 } }) })
    expect(result.current.factors).toEqual({ k: "1" })
    expect(result.current.factorsBaseUpdatedAt).toBe(T0)
    expect(result.current.factorsStale).toBe(true)
    act(() => result.current.resetFactors())
    expect(result.current.factors).toEqual({ k: "1.5" })
    expect(result.current.factorsBaseUpdatedAt).toBe(T1)
    expect(result.current.factorsStale).toBe(false)
  })
})

describe("policyChanges", () => {
  it("names the models whose routing differs, and the other settings once", () => {
    expect(policyChanges(policy({ a: 1, b: 2 }, { billAnomalyMultiple: 5 }), policy({ a: 1, b: 3, c: 4 }, { billAnomalyMultiple: 6 }))).toEqual(["the routing of b", "the routing of c", "the alert and billing settings"])
    expect(policyChanges(policy({ a: 1 }), policy({ a: 1 }))).toEqual([])
  })
})
