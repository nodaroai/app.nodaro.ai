import { describe, expect, it } from "vitest"
import type { TimelineItemView, TimelineView } from "../edit-plan"
import { layoutRows } from "../layout-rows"
import { coverRegion, pictureAspect, pictureSlots, placeOf, speakerCopiesOf, speakerRegion, videoUnder, visibleRegion } from "../picture-place"
import { arrangePicture, type ApplyOps } from "../run/place-picture"

const WIDE = { width: 1920, height: 1080 }
const TALL = { width: 1080, height: 1920 }

describe("where a picture on the words shows", () => {
  it("splits a wide frame left and right, and a tall one top and bottom, the picture first", () => {
    expect(pictureSlots(WIDE, "split")).toEqual({ picture: { x: 0, y: 0, w: 960, h: 1080 }, speaker: { x: 960, y: 0, w: 960, h: 1080 } })
    expect(pictureSlots(TALL, "split")).toEqual({ picture: { x: 0, y: 0, w: 1080, h: 960 }, speaker: { x: 0, y: 960, w: 1080, h: 960 } })
    expect(pictureSlots(WIDE, "full").picture).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
    expect(pictureSlots(WIDE, "window").speaker).toBeUndefined()
  })

  it("asks for a square picture beside the speaker, and the frame's own shape otherwise", () => {
    expect(pictureAspect(WIDE, "split")).toBe("1:1")
    expect(pictureAspect(TALL, "split")).toBe("1:1")
    expect(pictureAspect(WIDE, "full")).toBe("16:9")
    expect(pictureAspect(TALL, "window")).toBe("9:16")
  })

  it("reads what the frame shows of a clip from where the clip is placed", () => {
    // The clip fills the frame exactly.
    expect(visibleRegion({ x: 0, y: 0, width: 1920, height: 1080 }, WIDE)).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    // A wide recording covering a phone frame, moved so its right side shows.
    const cover = { x: -500, y: 0, width: 3413, height: 1920 }
    const seen = visibleRegion(cover, TALL)
    expect(seen.w).toBeCloseTo(1080 / 3413)
    expect(seen.x).toBeCloseTo((3413 / 2 - 540 + 500) / 3413)
    expect(seen.h).toBe(1)
  })

  it("keeps the middle of what the frame shows for the speaker's half, a little above the middle", () => {
    const half = pictureSlots(WIDE, "split").speaker!
    // A wide frame's half is tall: the middle half across, the whole height.
    expect(speakerRegion({ x: 0, y: 0, w: 1, h: 1 }, half, WIDE)).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 })
    // A tall frame's half is wide: the whole width, and the upper part of the height.
    const low = pictureSlots(TALL, "split").speaker!
    const kept = speakerRegion({ x: 0, y: 0, w: 1, h: 1 }, low, TALL)
    expect(kept.w).toBe(1)
    expect(kept.h).toBeCloseTo(0.5)
    expect(kept.y).toBeCloseTo(0.15)
  })

  it("gives a window the picture’s own shape, so nothing of it is cut", () => {
    // A square picture on a tall frame: as tall as a window may be, in the middle across.
    expect(pictureSlots(TALL, "window", 1).picture).toEqual({ x: 195, y: 115, w: 691, h: 691 })
    // On a wide frame: as tall as a window may be, at the left.
    expect(pictureSlots(WIDE, "window", 1).picture).toMatchObject({ x: 115, w: 670, h: 670 })
    // A wide picture on a tall frame takes the window's whole width and less of its height.
    expect(pictureSlots(TALL, "window", 16 / 9).picture).toMatchObject({ w: 907, h: 510 })
    // Without a shape, the window is the room itself.
    expect(pictureSlots(TALL, "window").picture).toEqual({ x: 87, y: 115, w: 907, h: 691 })
  })

  it("keeps the middle of a picture in the shape of its part", () => {
    expect(coverRegion({ width: 1000, height: 1000 }, { x: 0, y: 0, w: 960, h: 1080 })).toMatchObject({ y: 0, h: 1 })
    expect(coverRegion({ width: 1000, height: 1000 }, { x: 0, y: 0, w: 1920, h: 1080 })).toMatchObject({ x: 0, w: 1 })
  })
})

// ── a small editor: enough of its edits to follow one picture being laid beside the speaker ──

const TRACKS = [
  { id: "t-video", order: 3 },
  { id: "t-copy", order: 2 },
  { id: "t-picture", order: 1 },
]
const MEDIA = [
  { id: "m-video", fileName: "talk.mp4" },
  { id: "m-pic", fileName: "ai-broll-abc-1.png" },
]

function editor(start: TimelineItemView[]) {
  let items = start
  let n = 0
  const sent: string[] = []
  const view = (): TimelineView => ({ fps: 30, durationInFrames: 3000, width: WIDE.width, height: WIDE.height, tracks: TRACKS, media: MEDIA, items })
  const apply: ApplyOps = async (ops) => {
    let results: unknown[] = []
    for (const op of ops) {
      sent.push(String(op.op))
      if (op.op === "removeItems") items = items.filter((i) => !(op.ids as string[]).includes(i.id))
      if (op.op === "splitItems") {
        for (const frame of op.frames as number[]) {
          items = items.flatMap((i) => {
            if (!(op.ids as string[]).includes(i.id) && !i.id.startsWith("cut-")) return [i]
            if (frame <= i.from || frame >= i.from + i.durationInFrames) return [i]
            n += 1
            return [
              { ...i, durationInFrames: frame - i.from },
              { ...i, id: `cut-${n}`, from: frame, durationInFrames: i.from + i.durationInFrames - frame },
            ]
          })
        }
      }
      if (op.op === "duplicateItems") {
        const copies = (op.ids as string[]).map((id) => ({ of: id, id: `copy-of-${id}` }))
        items = [...items, ...copies.map((c) => ({ ...items.find((i) => i.id === c.of)!, id: c.id, trackId: "t-copy" }))]
        results = [{ trackId: "t-copy", copies }]
      }
      if (op.op === "setTransform") items = items.map((i) => (i.id === op.id ? { ...i, transform: op.transform as TimelineItemView["transform"] } : i))
    }
    return { ok: true, results, timeline: view() }
  }
  return { apply, view, sent }
}

const footage: TimelineItemView = { id: "v1", type: "video", trackId: "t-video", from: 0, durationInFrames: 3000, mediaId: "m-video", transform: { x: 0, y: 0, width: 1920, height: 1080 } }
// A square picture, laid to cover the frame as the editor first places it.
const picture: TimelineItemView = { id: "p1", type: "image", trackId: "t-picture", from: 300, durationInFrames: 90, mediaId: "m-pic", transform: { x: 0, y: 0, width: 1920, height: 1920 } }

describe("a picture laid beside the speaker", () => {
  it("cuts the footage at the picture's ends, copies that stretch for the speaker's half, and leaves the footage as it was", async () => {
    const ed = editor([footage, picture])
    const out = await arrangePicture(ed.apply, ed.view(), { pictureId: "p1", mediaId: "m-video", place: "split", motion: "push" })
    expect(out).toEqual({ ok: true, place: "split" })
    const after = ed.view()
    const copies = speakerCopiesOf(after, after.items.find((i) => i.id === "p1")!)
    expect(copies).toHaveLength(1)
    expect(copies[0]).toMatchObject({ from: 300, durationInFrames: 90, trackId: "t-copy" })
    // The speaker's copy shows the middle half of the recording in the right half of the frame.
    expect(copies[0]!.transform).toMatchObject({ x: 480, y: 0, width: 1920, height: 1080 })
    // The picture fills the left half.
    expect(after.items.find((i) => i.id === "p1")!.transform).toMatchObject({ x: -480, y: 0, width: 1080, height: 1080 })
    // The footage is cut in three and is otherwise untouched.
    const pieces = after.items.filter((i) => i.trackId === "t-video")
    expect(pieces.map((i) => [i.from, i.durationInFrames])).toEqual([[0, 300], [300, 90], [390, 2610]])
    expect(pieces.every((i) => i.transform?.width === 1920 && i.transform.x === 0)).toBe(true)
    expect(placeOf(after, after.items.find((i) => i.id === "p1")!)).toBe("split")
    expect(videoUnder(after, 300)).toBe("m-video")
    // The copy beside a picture is not a speaker layout.
    expect(layoutRows(after)).toEqual([])
  })

  it("takes the speaker's copy off when the picture is shown another way", async () => {
    const ed = editor([footage, picture])
    await arrangePicture(ed.apply, ed.view(), { pictureId: "p1", mediaId: "m-video", place: "split", motion: "push" })
    const out = await arrangePicture(ed.apply, ed.view(), { pictureId: "p1", mediaId: "m-video", place: "full", motion: "push" })
    expect(out).toEqual({ ok: true, place: "full" })
    const after = ed.view()
    expect(after.items.some((i) => i.trackId === "t-copy")).toBe(false)
    expect(after.items.find((i) => i.id === "p1")!.transform).toMatchObject({ x: 0, y: 0, width: 1920, height: 1920 })
    expect(placeOf(after, after.items.find((i) => i.id === "p1")!)).toBe("full")
    expect(ed.sent).toContain("addKeyframe")
  })

  it("fills the frame where the speaker layout already shows the video in parts", async () => {
    const part: TimelineItemView = { ...footage, id: "v1-part", trackId: "t-copy" }
    const ed = editor([footage, part, picture])
    const out = await arrangePicture(ed.apply, ed.view(), { pictureId: "p1", mediaId: "m-video", place: "split", motion: "pull" })
    expect(out).toEqual({ ok: true, place: "full" })
    expect(ed.sent).not.toContain("splitItems")
    expect(ed.sent).not.toContain("duplicateItems")
  })

  it("shows a picture in a window without touching the footage", async () => {
    const ed = editor([footage, picture])
    const out = await arrangePicture(ed.apply, ed.view(), { pictureId: "p1", mediaId: "m-video", place: "window", motion: "push" })
    expect(out).toEqual({ ok: true, place: "window" })
    const after = ed.view()
    expect(after.items.filter((i) => i.mediaId === "m-video")).toHaveLength(1)
    expect(placeOf(after, after.items.find((i) => i.id === "p1")!)).toBe("window")
  })
})
