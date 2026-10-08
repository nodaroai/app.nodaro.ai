import { describe, expect, it } from "vitest"
import { clipLiveRun } from "../clip-live"

// The Clip Pack inspector's view of a live run (A4-2): the quality it renders
// at, which clips have landed, and how far along it is.
const take = (clipKey: string, quality = "final") => ({ url: `https://cdn.test/${clipKey}.mp4`, quality, clipKey })
const idle = { running: false, started: null, fallbackTotal: 4 } as const

describe("clipLiveRun", () => {
  it("is nothing while no run includes the render", () => {
    expect(clipLiveRun({ __listTotal: 4 }, idle)).toBeUndefined()
  })

  it("names the quality the inspector started, else the row stamps', else a Preview", () => {
    const running = { running: true, started: null, fallbackTotal: 4 } as const
    expect(clipLiveRun({}, { ...running, started: "final" })?.quality).toBe("final")
    expect(clipLiveRun({ __listResultStamps: [{ quality: "final", clipKey: "0-1" }] }, running)?.quality).toBe("final")
    expect(clipLiveRun({}, running)?.quality).toBe("proxy")
    // What the person started wins over a stamp left by the batch.
    expect(clipLiveRun({ __listResultStamps: [{ quality: "proxy" }] }, { ...running, started: "final" })?.quality).toBe("final")
  })

  it("lists the clips whose take has landed, by the take's key or its row's stamp", () => {
    const data = {
      __listResults: ["https://cdn.test/a.mp4", "https://cdn.test/b.mp4", ""],
      generatedResults: [take("a"), { url: "https://cdn.test/b.mp4", quality: "final" }],
      __listResultStamps: [{ clipKey: "a" }, { clipKey: "b" }, { clipKey: "c" }],
    }
    const live = clipLiveRun(data, { running: true, started: "final", fallbackTotal: 3 })!
    expect([...live.landed].sort()).toEqual(["a", "b"])
  })

  it("counts progress from the render's own counters, else the landed clips of those it was sent", () => {
    const running = { running: true, started: "final", fallbackTotal: 6 } as const
    expect(clipLiveRun({ __listCompleted: 2, __listTotal: 5 }, running)).toMatchObject({ done: 2, total: 5 })
    expect(clipLiveRun({ __listResults: ["https://cdn.test/a.mp4"], generatedResults: [take("a")] }, running)).toMatchObject({ done: 1, total: 6 })
    expect(clipLiveRun({ __listCompleted: 9, __listTotal: 5 }, running)).toMatchObject({ done: 5, total: 5 })
    expect(clipLiveRun({ __listCompleted: "x", __listTotal: -1 }, running)).toMatchObject({ done: 0, total: 6 })
  })
})
