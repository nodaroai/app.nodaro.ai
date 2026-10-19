/**
 * A use-case run whose chain holds a step the caller may not run is refused up
 * front, naming that step as the node list names it (inner-availability.ts).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest"

const denied = vi.hoisted(() => ({ types: [] as string[], asked: [] as Array<[string, string]> }))
vi.mock("../../availability-viewer.js", () => ({
  isNodeDeniedForUser: async (type: string, userId: string) => {
    denied.asked.push([type, userId])
    return denied.types.includes(type)
  },
}))
import { usecaseInnerDenial, usecaseMulticamAvailable, usecaseMulticamDenial, usecaseMulticamEstimateFor, usecaseMulticamForEveryone } from "../inner-availability.js"
import { __availabilityUniverseReadyForTests, __resetAvailabilityOverridesForTests } from "../../availability-override.js"

const USER = "00000000-0000-4000-8000-000000000001"
const chain = [{ type: "upload-video" }, { type: "upload-video" }, { type: "transcribe" }, { type: "speaker-map" }, { type: "camera-switch" }]

beforeEach(() => {
  denied.types = []
  denied.asked = []
})

describe("usecaseInnerDenial", () => {
  it("a chain of steps the caller may run: null, each type asked once", async () => {
    expect(await usecaseInnerDenial("tighten-episode", chain, USER)).toBeNull()
    expect(denied.asked).toEqual([["upload-video", USER], ["transcribe", USER], ["speaker-map", USER], ["camera-switch", USER]])
  })
  it("one withheld step: 403 node_not_available, naming it by its registry label", async () => {
    denied.types = ["speaker-map"]
    expect(await usecaseInnerDenial("tighten-episode", chain, USER)).toEqual({
      status: 403,
      code: "node_not_available",
      message: "Tighten Episode needs Speaker Map for this run, which is not available on this deployment.",
    })
  })
  it("several withheld steps: each named, once", async () => {
    denied.types = ["speaker-map", "camera-switch"]
    expect((await usecaseInnerDenial("tighten-episode", [...chain, { type: "speaker-map" }], USER))!.message).toBe(
      "Tighten Episode needs Speaker Map, Camera Switch for this run, which are not available on this deployment.",
    )
  })
  it("a type the registry does not know is named as written", async () => {
    denied.types = ["no-such-node"]
    expect((await usecaseInnerDenial("episode-chapters", [{ type: "no-such-node" }], USER))!.message).toBe(
      "Chapters needs no-such-node for this run, which is not available on this deployment.",
    )
  })
})

describe("several recordings follow Speaker Map's availability (decided 2026-10-19)", () => {
  const A = "https://r2/a.mp4", B = "https://r2/b.mp4", M = "https://r2/m.wav"
  it("usecaseMulticamAvailable: yes while Speaker Map is the user's; no while it is withheld, or with no user", async () => {
    expect(await usecaseMulticamAvailable(USER)).toBe(true)
    denied.types = ["speaker-map"]
    expect(await usecaseMulticamAvailable(USER)).toBe(false)
    expect(await usecaseMulticamAvailable(undefined)).toBe(false)
  })
  it("a request for several recordings or a Master audio, Speaker Map withheld: 403 with its own words", async () => {
    denied.types = ["speaker-map"]
    for (const body of [{ mediaUrls: [A, B] }, { mediaUrls: [A], masterAudioUrl: M }]) {
      expect(await usecaseMulticamDenial("tighten-episode", body, USER)).toEqual({
        status: 403,
        code: "node_not_available",
        message: "Tighten Episode on several recordings or with a Master audio is not available on this deployment yet. Send one recording.",
      })
    }
  })
  it("one recording (its own file as master too) is never refused; nor is anything while Speaker Map is the user's", async () => {
    denied.types = ["speaker-map"]
    expect(await usecaseMulticamDenial("tighten-episode", { mediaUrls: [A] }, USER)).toBeNull()
    expect(await usecaseMulticamDenial("tighten-episode", { mediaUrls: [A], masterAudioUrl: A }, USER)).toBeNull()
    denied.types = []
    expect(await usecaseMulticamDenial("tighten-episode", { mediaUrls: [A, B], masterAudioUrl: M }, USER)).toBeNull()
  })
})

describe("usecaseMulticamEstimateFor: whose recordings an estimate prices (decided 2026-10-19)", () => {
  it("a graph with a use-case node that takes several recordings: the viewer's own answer", async () => {
    const graph = [{ type: "upload-video" }, { type: "tighten-episode" }]
    expect(await usecaseMulticamEstimateFor(graph, USER)).toBe(true)
    denied.types = ["speaker-map"]
    expect(await usecaseMulticamEstimateFor(graph, USER)).toBe(false)
    expect(await usecaseMulticamEstimateFor(graph, null)).toBe(false)
  })
  it("a graph with no such node: no, and nothing is asked", async () => {
    expect(await usecaseMulticamEstimateFor([{ type: "upload-video" }, { type: "episode-chapters" }, { type: "apply-edl" }], USER)).toBe(false)
    expect(await usecaseMulticamEstimateFor([], USER)).toBe(false)
    expect(denied.asked).toEqual([])
  })
})

describe("usecaseMulticamForEveryone: what a listing prices (decided 2026-10-20)", () => {
  beforeAll(() => __availabilityUniverseReadyForTests())
  afterEach(() => __resetAvailabilityOverridesForTests())
  const graph = [{ type: "upload-video" }, { type: "tighten-episode" }]
  it("follows Speaker Map's availability to a general user, whoever asks", () => {
    __resetAvailabilityOverridesForTests({ nodes: new Set(["tighten-episode"]) })
    expect(usecaseMulticamForEveryone(graph)).toBe(false)
    __resetAvailabilityOverridesForTests({ nodes: new Set(["tighten-episode", "speaker-map"]) })
    expect(usecaseMulticamForEveryone(graph)).toBe(true)
    expect(denied.asked).toEqual([])
  })
  it("a graph with no use-case node that takes several recordings: no", () => {
    expect(usecaseMulticamForEveryone([{ type: "episode-chapters" }, { type: "upload-video" }])).toBe(false)
  })
})
