/**
 * Fixtures for a template's kept example run: the shipped "UGC Video From Your Site" template as one
 * finished AI-creator run leaves it. The URLs are placeholders.
 */
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATE = join(HERE, "..", "tutorial-seed", "templates", "ugc-website-video.json")

export type Data = Record<string, unknown>
export type N = { id: string; type: string; position?: unknown; data: Data }
export type E = { id?: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

export const AI_IMAGE = "https://cdn.example/images/11111111-1111-4111-8111-111111111111.png"
export const TAKE_1 = "https://cdn.example/videos/22222222-2222-4222-8222-222222222222.mp4"
export const TAKE_2 = "https://cdn.example/videos/33333333-3333-4333-8333-333333333333.mp4"
export const JOINED = "https://cdn.example/videos/44444444-4444-4444-8444-444444444444.mp4"
export const OVERLAID = "https://cdn.example/videos/55555555-5555-4555-8555-555555555555.mp4"
export const CAPTIONED = "https://cdn.example/videos/66666666-6666-4666-8666-666666666666.mp4"
export const AUTHOR_FACE = "https://cdn.example/uploads/author-face.png"
/** Run state that must never ship, planted where a run leaves it. */
export const SECRET = "SECRET-RUN-STATE"

export async function loadTemplate(): Promise<{ nodes: N[]; edges: E[] }> {
  const doc = JSON.parse(await readFile(TEMPLATE, "utf8")) as { nodes: N[]; edges: E[] }
  return { nodes: doc.nodes, edges: doc.edges }
}

/** The template as one finished AI-creator run leaves it, with `patch` applied per node id. */
export async function ranTemplate(patch: Record<string, Data> = {}): Promise<{ nodes: N[]; edges: E[] }> {
  const { nodes, edges } = await loadTemplate()
  const run: Record<string, Data> = {
    script: {
      keepResult: false,
      result: { plan: { v: 1, hook: "Hook line.", beats: [{ line: "Beat one.", secret: SECRET }], closer: { line: "Closer line.", action: SECRET } }, productCategory: "food", warnings: [], notes: [SECRET], rounds: 1 },
      ugcOutputs: { plan: SECRET, category: "food" },
    },
    creator: {
      source: "sampled",
      keepResult: false,
      generatedImageUrl: AI_IMAGE,
      result: { v: 1, kind: "sampled", gender: "woman", identityImages: [AI_IMAGE], traits: { secret: SECRET }, seed: 7, promptsVersion: SECRET },
      ugcOutputs: { creator: SECRET, image: AI_IMAGE },
    },
    clips: { result: { secret: SECRET }, __listResults: [SECRET, SECRET], quote: { lines: [], expected: 1, ceiling: 2 }, ugcOutputs: { clips: SECRET } },
    clip: {
      __listResults: [TAKE_1, TAKE_2],
      __listResultMeta: [{ durationSec: 7.5, warnings: [SECRET] }, { durationSec: 6 }],
      generatedVideoUrl: TAKE_1,
      generatedResults: [{ url: TAKE_1, jobId: "job-take-1" }, { url: TAKE_2, jobId: "job-take-2" }],
      activeResultIndex: 0,
      rerender: { "1": 1 },
      clipWarnings: [SECRET],
      ugcOutputs: { "video-out": SECRET },
    },
    join: { generatedVideoUrl: JOINED, generatedResults: [{ url: "https://cdn.example/videos/old-join.mp4", jobId: "j0" }, { url: JOINED, jobId: "j1" }], activeResultIndex: 1 },
    cards: { result: { layerPlan: "{\"layers\":[]}", captionPlan: "{\"words\":[]}", report: "Notes text." }, ugcOutputs: { layerPlan: SECRET }, generatedText: SECRET, text: SECRET },
    overlay: { generatedVideoUrl: OVERLAID, generatedResults: [{ url: OVERLAID, jobId: "j2" }], activeResultIndex: 0 },
    captions: { generatedVideoUrl: CAPTIONED, generatedResults: [{ url: CAPTIONED, jobId: "j3", thumbnailUrl: "https://cdn.example/thumbnails/j3.jpg" }], activeResultIndex: 0 },
  }
  return {
    nodes: nodes.map((n) => ({ ...n, data: { ...n.data, ...(run[n.id] ?? {}), ...(patch[n.id] ?? {}) } })),
    edges,
  }
}


/** A video cut from one recorded speech (the Hebrew lane): UGC Finish's job made these from the takes. */
export const FINISH_JOB = "77777777-7777-4777-8777-777777777777"
export const FINISHED_1 = `https://cdn.example/ugc/finish/${FINISH_JOB}/clip1.mp4`
export const FINISHED_2 = `https://cdn.example/ugc/finish/${FINISH_JOB}/clip2.mp4`
/** The speech a finish job lays back over each clip (the split job's padded segment audio). */
export const SEGMENT_AUDIO = "https://cdn.example/ugc/segments/88888888-8888-4888-8888-888888888888/seg1.mp3"

/** The template as one finished run of a video cut from one recorded speech leaves it: UGC Finish holds the finished clips. */
export async function ranSpeechCutTemplate(patch: Record<string, Data> = {}): Promise<{ nodes: N[]; edges: E[] }> {
  return ranTemplate({
    finish: {
      __listResults: [FINISHED_1, FINISHED_2],
      __listResultMeta: [{ durationSec: 5.9, warnings: [SECRET] }, { durationSec: 6.1, warnings: [] }],
      generatedVideoUrl: FINISHED_1,
      generatedResults: [{ url: FINISHED_1, jobId: "job-finish" }, { url: FINISHED_2, jobId: "job-finish" }],
      activeResultIndex: 0,
      ugcOutputs: { "video-out": SECRET },
    },
    ...patch,
  })
}

/** The finish job's row: one roll per clip (the takes), the speech it laid back, the finished clips it wrote. */
export function finishJobRow(owner: string, rolls: readonly string[] = [TAKE_1, TAKE_2]) {
  return {
    id: FINISH_JOB,
    user_id: owner,
    status: "completed",
    input_data: {
      type: "ugc-finish",
      segments: rolls.map((_, i) => ({ index: i + 1, text: "שלום", paddedAudioUrl: SEGMENT_AUDIO })),
      clips: rolls.map((url, i) => ({ clip: i + 1, rolls: [url] })),
    },
    output_data: { ready: true, clips: [{ clip: 1, url: FINISHED_1, sec: 5.9 }, { clip: 2, url: FINISHED_2, sec: 6.1 }] },
  }
}
