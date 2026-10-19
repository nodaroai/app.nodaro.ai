import { describe, it, expect } from "vitest"
import { unitInputHandleIn, unitInputLaneOf, unitInputLanding, unitLaneTakesSource } from "@nodaro/render-rules"

/**
 * Where a node unit's JSON and many-wire inputs land (decided 2026-10-18): the
 * one rule both engines' resolvers apply, so a unit's payload.ts and exec.ts
 * read the same `unitInputs`.
 */
const media = (sourceNodeId: string, value: string, kind: "video" | "audio" | undefined = "video") =>
  ({ many: true, json: false, sourceNodeId, value, kind }) as const
const json = (sourceNodeId: string, value: string) => ({ many: false, json: true, sourceNodeId, value, kind: undefined }) as const

describe("unitInputLanding", () => {
  it("a many-wire input keeps one row per upstream node, in wire order", () => {
    let v = unitInputLanding(undefined, media("a", "https://r2/a.mp4"))
    v = unitInputLanding(v, media("m", "https://r2/m.wav", "audio"))
    v = unitInputLanding(v, media("a", "https://r2/a2.mp4")) // a second wire from the same node is not a second row
    expect(v).toEqual([{ id: "a", url: "https://r2/a.mp4", kind: "video" }, { id: "m", url: "https://r2/m.wav", kind: "audio" }])
  })

  it("a many-wire input skips a wire whose upstream produced nothing (no row, the wire is still recorded)", () => {
    expect(unitInputLanding(undefined, media("a", ""))).toEqual([])
    const one = unitInputLanding(undefined, media("a", "https://r2/a.mp4"))
    expect(unitInputLanding(one, media("b", ""))).toEqual(one)
  })

  it("a media row of unknown kind is read as video (the pricier chain; never under-quoted)", () => {
    expect(unitInputLanding(undefined, media("x", "u", undefined))).toEqual([{ id: "x", url: "u", kind: "video" }])
  })

  it("a JSON input keeps the wired string; of two real wires the last wins", () => {
    expect(unitInputLanding(undefined, json("t", "{\"words\":[]}"))).toBe("{\"words\":[]}")
    expect(unitInputLanding("{\"a\":1}", json("u", "{\"b\":2}"))).toBe("{\"b\":2}")
  })

  it("a wired JSON input whose upstream produced nothing records \"\" (the run is refused, never read as unwired)", () => {
    expect(unitInputLanding(undefined, json("t", ""))).toBe("")
  })

  it("an empty JSON wire never erases a real value on another wire", () => {
    expect(unitInputLanding("{\"a\":1}", json("t", ""))).toBe("{\"a\":1}")
    expect(unitInputLanding(unitInputLanding(undefined, json("t", "")), json("u", "{\"a\":1}"))).toBe("{\"a\":1}")
  })
})

describe("unitInputLaneOf", () => {
  it("many: true → many; accepts look → json; a field input → no lane (routed by source type)", () => {
    expect(unitInputLaneOf({ id: "sources", accepts: ["video", "audio"], many: true })).toBe("many")
    expect(unitInputLaneOf({ id: "plan", accepts: ["look"] })).toBe("json")
    const fieldInput = { id: "in", accepts: ["video"], field: "videoUrl" }
    expect(unitInputLaneOf(fieldInput)).toBeUndefined()
    expect(unitInputLaneOf({ id: "img", accepts: ["image"] })).toBeUndefined()
  })
})

describe("unitInputHandleIn", () => {
  const worker = {
    execution: { kind: "worker" },
    handles: { inputs: [{ id: "sources", accepts: ["video"], many: true as const }, { id: "plan", accepts: ["look"] }] },
  }
  it("the input a wire's target handle names", () => {
    expect(unitInputHandleIn(worker, "plan")?.id).toBe("plan")
    expect(unitInputHandleIn(worker, "sources")?.many).toBe(true)
  })
  it("undefined for no unit, no handle, an unknown handle, or a use-case unit (routeUseCaseInput routes those)", () => {
    expect(unitInputHandleIn(undefined, "plan")).toBeUndefined()
    expect(unitInputHandleIn(worker, null)).toBeUndefined()
    expect(unitInputHandleIn(worker, undefined)).toBeUndefined()
    expect(unitInputHandleIn(worker, "nope")).toBeUndefined()
    expect(unitInputHandleIn({ ...worker, execution: { kind: "use-case" } }, "plan")).toBeUndefined()
  })
})

describe("unitLaneTakesSource", () => {
  const textSources = new Set(["text-prompt", "transcribe"])
  it("a parameter picker that is not a text source lands nothing", () => {
    expect(unitLaneTakesSource("mood", textSources)).toBe(false)
    expect(unitLaneTakesSource("lens", textSources)).toBe(false)
  })
  it("a parameter that is also a text source, any other source, or an untyped one is taken", () => {
    expect(unitLaneTakesSource("text-prompt", textSources)).toBe(true)
    expect(unitLaneTakesSource("transcribe", textSources)).toBe(true)
    expect(unitLaneTakesSource("upload-video", textSources)).toBe(true)
    expect(unitLaneTakesSource(undefined, textSources)).toBe(true)
  })
})
