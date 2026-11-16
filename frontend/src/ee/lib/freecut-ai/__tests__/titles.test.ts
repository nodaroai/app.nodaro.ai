import { describe, expect, it } from "vitest"
import type { TimelineView } from "../edit-plan"
import { tidyTitle, type TitleChoice } from "../run/creative"
import { planTitles, titleCount, titleShots } from "../run/titles"
import { recordOf, titleRows, titleZone } from "../title-rows"
import { keyRuns, titleBox, titleFields, titleId, titleSeconds, type TitleRecord } from "../title-style"

const FPS = 30
const view = (extra: Partial<TimelineView> = {}): TimelineView => ({
  fps: FPS,
  durationInFrames: 60 * FPS,
  width: 1080,
  height: 1920,
  tracks: [
    { id: "v", order: 2 },
    { id: "p", order: 1 },
  ],
  media: [
    { id: "talk", fileName: "talk.mp4" },
    { id: "pic", fileName: "ai-broll-abc-1.png" },
  ],
  items: [{ id: "clip", type: "video", trackId: "v", from: 0, durationInFrames: 60 * FPS, mediaId: "talk", sourceStart: 0, sourceEnd: 60 * FPS, sourceFps: FPS }],
  ...extra,
})

const choice = (start: number, over: Partial<TitleChoice> = {}): TitleChoice => ({
  sentence: { index: 0, start: start - 1, end: start + 5, text: "" },
  kind: "words",
  text: "It changed the whole market",
  key: "whole market",
  sub: "",
  start,
  end: start + 1,
  until: start + 5,
  ...over,
})

const record: Omit<TitleRecord, "id"> = { kind: "words", text: "It changed the whole market", key: "whole market", look: "outline", place: "top", entry: "pop" }

describe("how many texts", () => {
  it("follows the video's length: two for half a minute, four for a minute, at most ten", () => {
    expect(titleShots(30)).toBe(2)
    expect(titleShots(60)).toBe(4)
    expect(titleShots(5)).toBe(1)
    expect(titleShots(3600)).toBe(10)
  })

  it("takes the person's number, from 1 to 20", () => {
    expect(titleCount(60, null)).toBe(4)
    expect(titleCount(60, 7)).toBe(7)
    expect(titleCount(60, 0)).toBe(1)
    expect(titleCount(60, 99)).toBe(20)
  })
})

describe("a text made fit for the screen", () => {
  it("keeps a line short and without end punctuation", () => {
    expect(tidyTitle("words", "This one thing changed the whole market forever.", "whole market", "")).toEqual({ text: "This one thing changed the whole", key: "whole market", sub: "" })
  })

  it("keeps a number only when it has a figure", () => {
    expect(tidyTitle("number", "37%", "", "price rise this year")).toEqual({ text: "37%", key: "", sub: "price rise this year" })
    expect(tidyTitle("number", "a lot", "", "")).toBeNull()
  })

  it("makes a list of two to four short lines", () => {
    expect(tidyTitle("list", "Budget | Timing | Patience", "", "")?.text).toBe("Budget\nTiming\nPatience")
    expect(tidyTitle("list", "Budget", "", "")).toBeNull()
  })
})

describe("the key words in color", () => {
  it("splits the line into runs, the spaces kept", () => {
    expect(keyRuns("It changed the whole market", "whole market")).toEqual([
      { text: "It changed the ", key: false },
      { text: "whole market", key: true },
    ])
  })

  it("matches Hebrew words, whatever the punctuation", () => {
    expect(keyRuns("זה שינה את כל השוק", "השוק!").at(-1)).toEqual({ text: "השוק", key: true })
  })
})

describe("the text item", () => {
  const canvas = { width: 1080, height: 1920 }
  const whole = { x: 0, y: 0, w: 1080, h: 1920 }

  it("sits in the top of its part of the frame, centered across", () => {
    const box = titleBox(record, whole, canvas)
    expect(box.x).toBe(0)
    expect(box.y).toBeLessThan(0)
    expect(box.width).toBe(Math.round(1080 * 0.88))
  })

  it("stays inside the speaker's half when the frame is split", () => {
    const half = { x: 0, y: 960, w: 1080, h: 960 }
    const box = titleBox(record, half, canvas)
    const top = box.y + canvas.height / 2 - box.height / 2
    expect(top).toBeGreaterThanOrEqual(960)
    expect(top + box.height).toBeLessThanOrEqual(1920)
  })

  it("colors the key words inline, with the look's line around the letters", () => {
    const fields = titleFields(record, whole, canvas, FPS)
    expect(fields.spanLayout).toBe("inline")
    expect((fields.textSpans as Array<{ text: string; color: string }>).map((s) => s.color)).toEqual(["#FFFFFF", "#8FDC5C"])
    expect(fields.stroke).toMatchObject({ color: "#000000" })
    expect(fields.backgroundColor).toBeUndefined()
  })

  it("stacks a big number over what it counts", () => {
    const fields = titleFields({ ...record, kind: "number", text: "37%", key: "", sub: "price rise" }, whole, canvas, FPS)
    const spans = fields.textSpans as Array<{ text: string; fontSize: number }>
    expect(fields.spanLayout).toBe("stack")
    expect(spans.map((s) => s.text)).toEqual(["37%", "price rise"])
    expect(spans[0]!.fontSize).toBeGreaterThan(spans[1]!.fontSize * 2)
  })

  it("brings a list in line by line, as far apart as the lines are said", () => {
    const fields = titleFields({ ...record, kind: "list", text: "Budget\nTiming", key: "", entry: "rise", lineGap: 1.5 }, whole, canvas, FPS)
    expect((fields.textMotion as { in: { unit: string; staggerFrames: number } }).in).toMatchObject({ unit: "line", staggerFrames: 45 })
  })

  it("keeps one box whatever is behind the text: the editor draws the color around the lines", () => {
    const sticker = { ...record, look: "sticker" as const, text: "Go" }
    expect(titleBox(sticker, whole, canvas)).toEqual(titleBox(record, whole, canvas))
  })

  it("takes the person’s colors: the words, the key words, and a color behind the text or none", () => {
    const fields = titleFields({ ...record, textColor: "#112233", color: "#445566", background: "#778899" }, whole, canvas, FPS)
    expect((fields.textSpans as Array<{ color: string }>).map((s) => s.color)).toEqual(["#112233", "#445566"])
    expect(fields.backgroundColor).toBe("#778899")
    expect(titleFields({ ...record, look: "sticker", background: null }, whole, canvas, FPS).backgroundColor).toBeUndefined()
  })

  it("stays two to four seconds", () => {
    expect(titleSeconds("words", 10, 10.5)).toBe(2)
    expect(titleSeconds("words", 10, 30)).toBe(4)
  })
})

describe("where a text may show", () => {
  const picture = (place: "full" | "window") => ({
    id: "picture",
    type: "image",
    trackId: "p",
    from: 300,
    durationInFrames: 90,
    mediaId: "pic",
    transform: place === "full" ? { x: 0, y: 0, width: 1080, height: 1920 } : { x: 0, y: -400, width: 900, height: 690 },
  })

  it("is the whole frame when no picture shows", () => {
    expect(titleZone(view(), 0, 90)).toEqual({ x: 0, y: 0, w: 1080, h: 1920 })
  })

  it("is nowhere while a picture fills the frame", () => {
    const v = view({ items: [...view().items, picture("full")] })
    expect(titleZone(v, 310, 340)).toBeNull()
    expect(titleZone(v, 0, 90)).not.toBeNull()
  })

  it("is under a window on a tall frame", () => {
    const zone = titleZone(view({ items: [...view().items, picture("window")] }), 310, 340)!
    expect(zone.y).toBeGreaterThan(0)
    expect(zone.y + zone.h).toBe(1920)
  })
})

describe("the plan", () => {
  it("lays each text on its words, ended before the next", () => {
    const planned = planTitles(view(), "talk", [choice(10), choice(12)], "outline", "s")
    expect(planned.map((p) => p.record.id)).toEqual([titleId("s", 1), titleId("s", 2)])
    expect(planned[0]!.from).toBe(Math.round((10 - 0.15) * FPS))
    expect(planned[0]!.from + planned[0]!.frames).toBeLessThanOrEqual(planned[1]!.from)
  })

  it("leaves out a text whose words were cut away", () => {
    const cut = view({ items: [{ ...view().items[0]!, durationInFrames: 5 * FPS, sourceEnd: 5 * FPS }] })
    expect(planTitles(cut, "talk", [choice(10)], "outline", "s")).toEqual([])
  })

  it("leaves out a text a full-frame picture covers", () => {
    const covered = view({ items: [...view().items, { id: "picture", type: "image", trackId: "p", from: 280, durationInFrames: 120, mediaId: "pic", transform: { x: 0, y: 0, width: 1080, height: 1920 } }] })
    expect(planTitles(covered, "talk", [choice(10)], "outline", "s")).toEqual([])
  })
})

describe("the list in the panel", () => {
  const withText = view({ items: [...view().items, { id: titleId("s", 1), type: "text", trackId: "t", from: 90, durationInFrames: 60, text: "Budget\nTiming" }, { id: "other", type: "text", trackId: "t", from: 300, durationInFrames: 60, text: "mine" }] })

  it("lists only the panel's own texts", () => {
    expect(titleRows(withText, []).map((r) => r.key)).toEqual([titleId("s", 1)])
  })

  it("takes a text it no longer remembers by its words", () => {
    const row = titleRows(withText, [])[0]!
    expect(recordOf(row, "clean")).toMatchObject({ kind: "list", text: "Budget\nTiming", look: "clean" })
  })
})
