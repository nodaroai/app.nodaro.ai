/**
 * What a server run hands the editor for the json producers: the scrapers,
 * Social Search, Extract Field, JSON Process, Describe to Picker, and the
 * job-backed json producers (Edit Plan, Transcribe, Silence Detect, Audio Sync,
 * Video Analysis / Audit).
 *
 * Each output is COMPUTED here by the code a run actually goes through — the
 * job-row reader (`buildNodeOutputFromJobData`) for the job-backed nodes, the
 * inline executors for Extract Field and JSON Process — and pinned in
 * `fixtures/json-producer-run-outputs.json`. The job rows are pinned INPUT
 * (`fixtures/json-producer-job-rows.json`): the editor's canvas run reads the
 * same rows, so its tests compare what a canvas run of a node writes with what
 * a server run of it writes (frontend `json-producers-run-results.test.ts`,
 * `json-run-result-canvas-shape.test.ts`). A change to what the server writes
 * fails here first, and the editor's mapping is re-checked against the new shape.
 */
import { describe, expect, it } from "vitest"
import { socialPostsDigest } from "@nodaro/shared"
import { executeExtractField, executeJsonProcess } from "../inline-executor.js"
import { buildNodeOutputFromJobData } from "../output-extractor.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"
import pinned from "./fixtures/json-producer-run-outputs.json"
import jobRows from "./fixtures/json-producer-job-rows.json"

const post = (id: string) => ({
  id,
  url: `https://media.example.test/post/${id}`,
  text: `post ${id}`,
  platform: "tiktok",
  author: { handle: `@${id}`, name: `Author ${id}` },
  metrics: { likes: 1 },
  media: {},
  hashtags: [],
  extra: {},
})

const PAGES = [
  { url: "https://site.example.test/a", title: "Page A", meta: { lang: "en" } },
  { url: "https://site.example.test/b", title: "Page B", meta: { lang: "fr" } },
]
const ADS = [{ adArchiveId: "ad-1", pageName: "Brand", body: "Ad one" }, { adArchiveId: "ad-2", pageName: "Brand", body: "Ad two" }]
const IG_POSTS = [{ id: "ig-1", caption: "First", displayUrl: "https://media.example.test/ig-1.jpg" }]
/** A Telegram Channel Feed post as the feed's route writes it (TelegramChannelPost). */
const feedPost = (id: number) => ({ id, channel: "acme", postUrl: `https://t.me/acme/${id}`, text: `post ${id}`, media: [] })
const FEED_POSTS = [feedPost(10), feedPost(11)]
/** A collection record as the collection routes write it (CollectionRecord). */
const collectionRecord = (id: string) => ({
  id,
  collectionId: "c1",
  title: `Story ${id}`,
  text: "The body.",
  url: `https://news.example.test/${id}`,
  media: [],
  fields: {},
  dedupeKey: `https://news.example.test/${id}`,
  source: { via: "node" },
  createdAt: "2026-10-06T09:00:00.000Z",
})
const RECORDS = [collectionRecord("r1"), collectionRecord("r2")]
const RECORDS_DIGEST = "- Story r1 · 2026-10-06 · https://news.example.test/r1\n- Story r2 · 2026-10-06 · https://news.example.test/r2"
const FEED_TEXT = "post 10\n\n---\n\npost 11"
/** The post readers emit Social Search posts: a saved one carries when it was saved, a competitor's its role. */
const SAVED_POSTS = [{ ...post("s1"), savedAt: "2026-10-06T09:00:00.000Z" }, { ...post("s2"), savedAt: "2026-10-05T09:00:00.000Z" }]
const BRAND_POSTS = [{ ...post("b1"), role: "own" }, { ...post("b2"), role: "about" }]
/** A job-backed node's output, from the job row its job wrote (pinned input). */
const fromJobRow = (type: keyof typeof jobRows) => buildNodeOutputFromJobData(jobRows[type] as Record<string, unknown>, type)

function inline(type: string, data: Record<string, unknown>, run: (node: SimpleNode, edges: SimpleEdge[], nodes: SimpleNode[], states: Record<string, NodeExecutionState>) => unknown) {
  const src: SimpleNode = { id: "src", type: "web-scrape", data: {} }
  const node: SimpleNode = { id: "n", type, data }
  const edges: SimpleEdge[] = [{ id: "e", source: "src", target: "n", sourceHandle: "json", targetHandle: "in" }]
  const states: Record<string, NodeExecutionState> = { src: { status: "completed", output: { json: PAGES } } }
  return run(node, edges, [src, node], states)
}

/** Node type (and case) → the node output a server run carries for it. */
function computeOutputs(): Record<string, unknown> {
  // A JSON round trip: what reaches the editor is the serialised state (an
  // `undefined` field is gone, exactly as over the stream and in node_states).
  return JSON.parse(
    JSON.stringify({
      "web-scrape": buildNodeOutputFromJobData({ json: PAGES }, "web-scrape"),
      "meta-ads-scrape": buildNodeOutputFromJobData({ json: ADS }, "meta-ads-scrape"),
      "instagram-scrape": buildNodeOutputFromJobData({ json: IG_POSTS }, "instagram-scrape"),
      // Every post found comes back; the node passes on the first `pickTop`.
      "social-search": buildNodeOutputFromJobData({ json: [post("p1"), post("p2"), post("p3")], pickTop: 2 }, "social-search"),
      // The feed's route writes the posts on json, one per listResults item, and the digest on text / generatedText.
      // Collections: Read Collection writes the records on json, one per listResults item, the digest on text;
      // Save to Collection writes the one record on json and its headline on text.
      "collection-read": buildNodeOutputFromJobData(
        { json: RECORDS, listResults: RECORDS.map((r) => JSON.stringify(r)), text: RECORDS_DIGEST, generatedText: RECORDS_DIGEST, count: 2, since: "2026-10-05T09:00:00.000Z", collectionName: "News" },
        "collection-read",
      ),
      "collection-write": buildNodeOutputFromJobData(
        { json: collectionRecord("r1"), text: "Story r1", generatedText: "Story r1", recordId: "r1", outcome: "inserted", evicted: 0, collectionName: "News" },
        "collection-write",
      ),
      // The post readers write the posts on json (one listResults item each, derived) and the digest on text / generatedText.
      "inspiration-read": buildNodeOutputFromJobData(
        { json: SAVED_POSTS, text: socialPostsDigest(SAVED_POSTS as never), generatedText: socialPostsDigest(SAVED_POSTS as never), count: 2, from: "2026-09-30T09:00:00.000Z", to: "2026-10-07T09:00:00.000Z" },
        "inspiration-read",
      ),
      "competitor-read": buildNodeOutputFromJobData(
        { json: BRAND_POSTS, text: socialPostsDigest(BRAND_POSTS as never), generatedText: socialPostsDigest(BRAND_POSTS as never), count: 2, from: "2026-09-30T09:00:00.000Z", to: "2026-10-07T09:00:00.000Z" },
        "competitor-read",
      ),
      "telegram-channel-feed": buildNodeOutputFromJobData(
        { json: FEED_POSTS, listResults: FEED_POSTS.map((p) => JSON.stringify(p)), text: FEED_TEXT, generatedText: FEED_TEXT, count: 2, latestId: 11 },
        "telegram-channel-feed",
      ),
      // The job row the route writes: the floored picker json, the pickers it filled, usage.
      "describe-to-picker": fromJobRow("describe-to-picker"),
      // The job-backed json producers, from the rows their jobs write.
      "edit-plan": fromJobRow("edit-plan"),
      transcribe: fromJobRow("transcribe"),
      "silence-detect": fromJobRow("silence-detect"),
      "audio-sync": fromJobRow("audio-sync"),
      "video-analysis": fromJobRow("video-analysis"),
      "video-audit": fromJobRow("video-audit"),
      // Text to Dialogue: the audio beside the timings the worker wrote as `transcript` (→ json).
      "text-to-dialogue": fromJobRow("text-to-dialogue"),
      // Speaker Frames: the stored track file's descriptor on json (notes and stats ride on the job row only).
      "speaker-frames": fromJobRow("speaker-frames"),
      "extract-field:text": inline("extract-field", { field: "title" }, (n, e, ns, s) => executeExtractField(n, e, ns, s)),
      "extract-field:list": inline("extract-field", { field: "title", outputType: "list" }, (n, e, ns, s) => executeExtractField(n, e, ns, s)),
      // A list of links: a lane must not add them to the node's results either.
      "extract-field:url-list": inline("extract-field", { field: "url", outputType: "list" }, (n, e, ns, s) => executeExtractField(n, e, ns, s)),
      "extract-field:json": inline("extract-field", { field: "meta", outputType: "json" }, (n, e, ns, s) => executeExtractField(n, e, ns, s)),
      "json-process": inline("json-process", { mode: "visual", inputPath: "", filters: [], projections: ["title"] }, (n, e, ns, s) => executeJsonProcess(n, e, ns, s)),
    }),
  )
}

describe("the node outputs a server run hands the editor for the later json producers", () => {
  it("are exactly the pinned fixture — a change here needs the editor's mapping re-checked (frontend json-producers-run-results.test.ts)", () => {
    expect(computeOutputs(), "update fixtures/json-producer-run-outputs.json, then check the editor lands the new shape").toEqual(pinned)
  })
})
