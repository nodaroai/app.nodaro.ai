/**
 * A template's kept example run, layer 2 (`proveKeptChain`): every value a video would keep is
 * proven by the author's own completed jobs, or the video keeps nothing. Each clause (L1–L3) has a
 * case that fails it alone. The ids and URLs are placeholders.
 */
import { describe, it, expect } from "vitest"
import { ugcKeepPlan, type UgcKeptChain } from "@nodaro/render-rules"
import { proveKeptChain, ugcFinishKeyJobId, UGC_CLIP_CREATOR_IMAGE_FIELD, type KeepJobRow } from "../ugc-template-keep-ledger.js"
import {
  AI_IMAGE, CAPTIONED, FINISH_JOB, FINISHED_1, FINISHED_2, JOINED, OVERLAID, TAKE_1, TAKE_2,
  finishJobRow, ranSpeechCutTemplate, ranTemplate,
} from "./ugc-template-keep-fixtures.js"

const OWNER = "author-1"
const idOf = (url: string) => url.replace(/^.*\/([0-9a-f-]{36})[^/]*$/, "$1")
const storageKey = (address: string) => (address.startsWith("https://cdn.example/") ? address.slice("https://cdn.example/".length).split(/[?#]/)[0]! : null)

/** The author's jobs behind a finished run of the template. */
function ledger(): KeepJobRow[] {
  return [
    { id: idOf(AI_IMAGE), user_id: OWNER, status: "completed", input_data: { type: "generate-image", prompt: "a person", model: "m" }, output_data: { imageUrl: AI_IMAGE } },
    ...[TAKE_1, TAKE_2].map((take, i) => ({
      id: idOf(take), user_id: OWNER, status: "completed",
      input_data: { type: "ugc-clip", clip: i + 1, durationSec: 7, [UGC_CLIP_CREATOR_IMAGE_FIELD]: AI_IMAGE },
      output_data: { videoUrl: take, durationSec: 7 },
    })),
    { id: idOf(JOINED), user_id: OWNER, status: "completed", input_data: { type: "combine-videos", videoUrls: [TAKE_1, TAKE_2] }, output_data: { videoUrl: JOINED } },
    { id: idOf(OVERLAID), user_id: OWNER, status: "completed", input_data: { type: "video-overlay", videoUrl: JOINED, layers: [{ imageUrl: "https://cdn.example/uploads/shot1.png" }] }, output_data: { videoUrl: OVERLAID } },
    { id: idOf(CAPTIONED), user_id: OWNER, status: "completed", input_data: { type: "add-captions", videoUrl: OVERLAID }, output_data: { videoUrl: CAPTIONED } },
  ]
}

async function chain(): Promise<UgcKeptChain> {
  const { nodes, edges } = await ranTemplate()
  const [c] = ugcKeepPlan(nodes, edges).chains
  return c!
}

async function prove(rows: KeepJobRow[], c?: UgcKeptChain): Promise<boolean> {
  return proveKeptChain(c ?? (await chain()), OWNER, { readJobs: async (ids, owner) => rows.filter((r) => ids.includes(r.id) && r.user_id === owner), storageKey })
}

const edit = (rows: KeepJobRow[], url: string, change: Partial<KeepJobRow>): KeepJobRow[] =>
  rows.map((r) => (r.id === idOf(url) ? { ...r, ...change } : r))

describe("proveKeptChain", () => {
  it("proves a finished AI-creator run from the author's own jobs, in one read", async () => {
    let reads = 0
    const c = await chain()
    const ok = await proveKeptChain(c, OWNER, { readJobs: async (ids) => { reads++; return ledger().filter((r) => ids.includes(r.id)) }, storageKey })
    expect(ok).toBe(true)
    expect(reads).toBe(1)
  })

  const failing: Array<[string, (rows: KeepJobRow[]) => KeepJobRow[]]> = [
    // L1
    ["no job made the creator image (a My photo run makes none)", (rows) => rows.filter((r) => r.id !== idOf(AI_IMAGE))],
    ["the creator image's job took an image (an edit of a photo)", (rows) => edit(rows, AI_IMAGE, { input_data: { type: "generate-image", prompt: "p", image: "https://cdn.example/uploads/author-face.png" } })],
    ["the creator image's job is another user's", (rows) => edit(rows, AI_IMAGE, { user_id: "someone-else" })],
    ["the creator image's job did not complete", (rows) => edit(rows, AI_IMAGE, { status: "failed" })],
    ["the creator image's job made another image", (rows) => edit(rows, AI_IMAGE, { output_data: { imageUrl: "https://cdn.example/images/other.png" } })],
    // L2
    ["a take's job records no creator image (a row from before the plugin wrote it)", (rows) => edit(rows, TAKE_1, { input_data: { type: "ugc-clip", clip: 1, durationSec: 7 } })],
    ["a take's job records another creator image (the author's photo)", (rows) => edit(rows, TAKE_2, { input_data: { type: "ugc-clip", [UGC_CLIP_CREATOR_IMAGE_FIELD]: "https://cdn.example/uploads/author-face.png" } })],
    ["a take was not made by a UGC Clip job", (rows) => edit(rows, TAKE_1, { input_data: { type: "upload-video", [UGC_CLIP_CREATOR_IMAGE_FIELD]: AI_IMAGE } })],
    ["no job made a take", (rows) => rows.filter((r) => r.id !== idOf(TAKE_2))],
    // L3
    ["the join took a video that is not one of the takes", (rows) => edit(rows, JOINED, { input_data: { type: "combine-videos", videoUrls: [TAKE_1, "https://cdn.example/videos/elsewhere.mp4"] } })],
    ["the captions were made from another video", (rows) => edit(rows, CAPTIONED, { input_data: { type: "add-captions", videoUrl: "https://cdn.example/videos/elsewhere.mp4" } })],
    ["a finish render's job names no video", (rows) => edit(rows, OVERLAID, { input_data: { type: "video-overlay" } })],
    ["no job made the captioned video", (rows) => rows.filter((r) => r.id !== idOf(CAPTIONED))],
  ]
  it.each(failing)("not proven: %s", async (_name, change) => {
    expect(await prove(change(ledger()))).toBe(false)
  })

  it("not proven: a reader that hands back another user's jobs (the proof checks the owner itself)", async () => {
    const theirs = ledger().map((r) => ({ ...r, user_id: "someone-else" }))
    expect(await proveKeptChain(await chain(), OWNER, { readJobs: async () => theirs, storageKey })).toBe(false)
  })

  it("not proven: two jobs claim the same output", async () => {
    const rows = ledger()
    const twin = { ...rows.find((r) => r.id === idOf(AI_IMAGE))!, id: `${idOf(AI_IMAGE)}` }
    expect(await proveKeptChain(await chain(), OWNER, { readJobs: async () => [...rows, twin], storageKey })).toBe(false)
  })

  it("not proven: an address that is not on our storage", async () => {
    const { nodes, edges } = await ranTemplate({
      creator: { generatedImageUrl: "https://elsewhere.example/a.png", result: { v: 1, kind: "sampled", identityImages: ["https://elsewhere.example/a.png"] } },
    })
    const [c] = ugcKeepPlan(nodes, edges).chains
    expect(await prove(ledger(), c)).toBe(false)
  })

  it("not proven: a chain layer 1 refused, whatever the ledger says", async () => {
    const { nodes, edges } = await ranTemplate({ creator: { source: "photo" } })
    const [c] = ugcKeepPlan(nodes, edges).chains
    expect(await prove(ledger(), c)).toBe(false)
  })

  it("a failed read throws (the publish refuses, writing nothing)", async () => {
    await expect(proveKeptChain(await chain(), OWNER, { readJobs: async () => { throw new Error("down") }, storageKey })).rejects.toThrow("down")
  })
})

describe("proveKeptChain: a video cut from one recorded speech (UGC Finish's job made the clips the join reads)", () => {
  /** The same run, the join made from UGC Finish's finished clips. */
  function speechCutLedger(): KeepJobRow[] {
    return [
      ...ledger().map((r) => (r.id === idOf(JOINED) ? { ...r, input_data: { type: "combine-videos", videoUrls: [FINISHED_1, FINISHED_2] } } : r)),
      finishJobRow(OWNER),
    ]
  }
  async function speechCutChain(): Promise<UgcKeptChain> {
    const { nodes, edges } = await ranSpeechCutTemplate()
    return ugcKeepPlan(nodes, edges).chains[0]!
  }
  const proveCut = async (rows: KeepJobRow[]) => prove(rows, await speechCutChain())
  const editFinish = (rows: KeepJobRow[], change: Partial<KeepJobRow>) => rows.map((r) => (r.id === FINISH_JOB ? { ...r, ...change } : r))

  it("names the finish job by the folder its clips are written to", () => {
    expect(ugcFinishKeyJobId(`ugc/finish/${FINISH_JOB}/clip2.mp4`)).toBe(FINISH_JOB)
    expect(ugcFinishKeyJobId(`ugc/finish/${FINISH_JOB}/acoustics/clip2.wav`)).toBeNull()
    expect(ugcFinishKeyJobId(`videos/${FINISH_JOB}.mp4`)).toBeNull()
    expect(ugcFinishKeyJobId("ugc/finish/not-a-job/clip1.mp4")).toBeNull()
  })

  it("proves the finished clips through the clip rows that rendered them, in one read", async () => {
    let reads = 0
    const ok = await proveKeptChain(await speechCutChain(), OWNER, {
      readJobs: async (ids) => { reads++; return speechCutLedger().filter((r) => ids.includes(r.id)) },
      storageKey,
    })
    expect(ok).toBe(true)
    expect(reads).toBe(1)
  })

  it("without the finish job's proof the join of the finished clips proves nothing (today's fail-closed case)", async () => {
    expect(await proveCut(speechCutLedger().filter((r) => r.id !== FINISH_JOB))).toBe(false)
  })

  const failing: Array<[string, (rows: KeepJobRow[]) => KeepJobRow[]]> = [
    ["the finish job is another user's", (rows) => editFinish(rows, { user_id: "someone-else" })],
    ["the finish job did not complete", (rows) => editFinish(rows, { status: "failed" })],
    ["the finish job is not a UGC Finish job", (rows) => editFinish(rows, { input_data: { ...finishJobRow(OWNER).input_data, type: "combine-videos" } })],
    ["the finish job finished a video that is not one of the takes", (rows) => editFinish(rows, finishJobRow(OWNER, [TAKE_1, "https://cdn.example/videos/elsewhere.mp4"]))],
    ["the finish job names no video", (rows) => editFinish(rows, { input_data: { type: "ugc-finish", clips: [] } })],
    ["the finish job wrote other clips", (rows) => editFinish(rows, { output_data: { ready: true, clips: [{ clip: 1, url: FINISHED_1 }] } })],
    // The trace runs through the clip rows: a take that row records another creator image for proves no finished clip.
    ["a take the finish job used records another creator image", (rows) => edit(rows, TAKE_2, { input_data: { type: "ugc-clip", [UGC_CLIP_CREATOR_IMAGE_FIELD]: "https://cdn.example/uploads/author-face.png" } })],
    ["a take the finish job used has no clip row", (rows) => rows.filter((r) => r.id !== idOf(TAKE_1))],
  ]
  it.each(failing)("not proven: %s", async (_name, change) => {
    expect(await proveCut(change(speechCutLedger()))).toBe(false)
  })

  it("not proven: a finished clip outside the finish job's folder, whatever its row says", async () => {
    const stray = `https://cdn.example/videos/${FINISH_JOB}.mp4`
    const { nodes, edges } = await ranSpeechCutTemplate({ finish: { __listResults: [stray, FINISHED_2] } })
    const c = ugcKeepPlan(nodes, edges).chains[0]!
    const rows = editFinish(speechCutLedger(), { output_data: { ready: true, clips: [{ clip: 1, url: stray }, { clip: 2, url: FINISHED_2 }] } })
    expect(await prove(rows, c)).toBe(false)
  })

  it("a UGC Finish that handed the takes on as they came (no finish job) is proven by the takes alone", async () => {
    const { nodes, edges } = await ranTemplate({ finish: { __listResults: [TAKE_1, TAKE_2], generatedVideoUrl: TAKE_1 } })
    const c = ugcKeepPlan(nodes, edges).chains[0]!
    expect(c.claims!.finished).toEqual([{ nodeId: "finish", urls: [TAKE_1, TAKE_2] }])
    expect(await prove(ledger(), c)).toBe(true)
  })
})
