import { describe, expect, it } from "vitest"
import type { TimelineItemView, TimelineView } from "../edit-plan"
import type { EditorLink } from "../editor-link"
import type { PictureRow } from "../picture-rows"
import { addPictureAtPlayhead, applyPictureChange } from "../run/change-picture"

const FPS = 30
const FULL = { x: 0, y: 0, width: 1920, height: 1080 }
const footage: TimelineItemView = { id: "clip", type: "video", trackId: "t-video", from: 0, durationInFrames: 3000, mediaId: "m-video", transform: FULL }
const picture = (id: string, from: number, frames: number): TimelineItemView => ({ id, type: "image", trackId: "t-picture", from, durationInFrames: frames, mediaId: "m-pic", transform: FULL })

/** An editor that answers with its timeline, keeps what it was sent, and trims a clip when asked to fit it. */
function editor(start: TimelineItemView[], currentFrame = 0) {
  let items = start
  const sent: Array<Record<string, unknown>> = []
  const view = (): TimelineView => ({
    fps: FPS,
    durationInFrames: 3000,
    width: 1920,
    height: 1080,
    currentFrame,
    tracks: [
      { id: "t-video", order: 2 },
      { id: "t-picture", order: 1 },
    ],
    media: [
      { id: "m-video", fileName: "talk.mp4" },
      { id: "m-pic", fileName: "ai-broll-abc-1.png" },
    ],
    items,
  })
  const link = {
    getTimeline: async () => view(),
    applyOps: async (_label: string, ops: ReadonlyArray<Record<string, unknown>>) => {
      for (const op of ops) {
        sent.push(op)
        if (op.op === "fitItem") items = items.map((i) => (i.id === op.id ? { ...i, durationInFrames: op.durationInFrames as number } : i))
      }
      return { ok: true, results: ops.map(() => ({})), timeline: view() }
    },
  } as unknown as EditorLink
  return { link, sent, ops: (name: string) => sent.filter((op) => op.op === name) }
}

const rowOf = (item: TimelineItemView): PictureRow => ({ key: item.id, source: "made", from: item.from, to: item.from + item.durationInFrames, itemId: item.id })
const request = { label: "change", userId: "u", signal: new AbortController().signal, onRecorded: () => undefined }

describe("a picture shown for another length", () => {
  it("fits the picture to the seconds asked", async () => {
    const first = picture("p1", 300, 60)
    const { link, ops } = editor([footage, first])
    const out = await applyPictureChange(link, { ...request, row: rowOf(first), choice: { kind: "length", seconds: 4 } })
    expect(out.ok).toBe(true)
    expect(ops("fitItem")).toEqual([{ op: "fitItem", id: "p1", durationInFrames: 4 * FPS }])
  })

  it("never runs into the next picture", async () => {
    const first = picture("p1", 300, 60)
    const { link, ops } = editor([footage, first, picture("p2", 390, 60)])
    await applyPictureChange(link, { ...request, row: rowOf(first), choice: { kind: "length", seconds: 8 } })
    expect(ops("fitItem")[0]).toMatchObject({ durationInFrames: 90 })
  })

  it("keeps to one second at the least and ten at the most", async () => {
    const first = picture("p1", 300, 60)
    const { link, ops } = editor([footage, first])
    await applyPictureChange(link, { ...request, row: rowOf(first), choice: { kind: "length", seconds: 0.2 } })
    await applyPictureChange(link, { ...request, row: rowOf(first), choice: { kind: "length", seconds: 99 } })
    expect(ops("fitItem").map((op) => op.durationInFrames)).toEqual([FPS, 10 * FPS])
  })
})

describe("a picture added by hand at the playhead", () => {
  const mine = { kind: "mine" as const, file: new File([new Uint8Array([1, 2, 3])], "mine.png", { type: "image/png" }) }

  it("is refused where a picture already shows, before anything is made", async () => {
    const { link, sent } = editor([footage, picture("p1", 300, 60)], 320)
    expect(await addPictureAtPlayhead(link, { ...request, choice: mine })).toEqual({ ok: false, taken: true })
    expect(sent).toEqual([])
  })

  it("is refused where less than a second is free before the next picture", async () => {
    const { link } = editor([footage, picture("p1", 300, 60)], 285)
    expect(await addPictureAtPlayhead(link, { ...request, choice: mine })).toEqual({ ok: false, taken: true })
  })

  it("has nothing to lie over where there is no video", async () => {
    const { link, sent } = editor([{ ...footage, durationInFrames: 100 }], 500)
    expect(await addPictureAtPlayhead(link, { ...request, choice: mine })).toEqual({ ok: false, refused: undefined })
    expect(sent).toEqual([])
  })
})
