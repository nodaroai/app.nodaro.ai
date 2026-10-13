/**
 * Render final's rule check (TA1 a) on a Speaker View fed a bare video with
 * face tracks wired before Speaker Frames has run: while video mode is not
 * live (R15) it refuses with the one video-mode sentence only — never "run
 * Speaker Frames first", which cannot run either (decided 2026-10-13). Once
 * video mode is live, the tracks refusal is said as before.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

// `priced`: Speaker View; `frames`: Speaker Frames. Video mode is open only with both (R15).
const flag = vi.hoisted(() => ({ priced: true, frames: false }))
vi.mock("@nodaro/render-rules", async (importOriginal) => (await import("@/test-utils/speaker-view-video-gate-mock")).withVideoGate(await importOriginal<typeof import("@nodaro/render-rules")>(), flag))

import { SPEAKER_VIEW_TRACKS_UNPRODUCED_MESSAGE, SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE } from "@nodaro/render-rules"
import { NO_EDL } from "@/lib/edl-validity"
import { renderRuleVerdict } from "../render-final-checks"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edge = (source: string, target: string, targetHandle: string, sourceHandle?: string) =>
  ({ id: `${source}->${target}:${targetHandle}`, source, target, targetHandle, ...(sourceHandle ? { sourceHandle } : {}) }) as unknown as WorkflowEdge

const TRANSCRIPT = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 400, speaker: "A" }, { text: "yo", startMs: 5_000, endMs: 5_400, speaker: "B" }] }

// Bare video → Transcribe + Speaker Frames (no output yet) → Speaker View, with a take from an earlier run.
const nodes = [
  node("up", "upload-video", { url: "https://cdn/clip.mp4", metadata: { width: 3840, height: 2160 } }),
  node("tx", "transcribe", { generatedResults: [{ url: "", transcript: TRANSCRIPT }], activeResultIndex: 0 }),
  node("sf", "speaker-frames"),
  node("sv", "speaker-view", { generatedResults: [{ url: "https://cdn/take.mp4", jobId: "j1", quality: "proxy" }] }),
]
const edges = [edge("up", "sv", "video"), edge("tx", "sv", "transcript"), edge("sf", "sv", "tracks", "tracks"), edge("up", "sf", "video")]

beforeEach(() => {
  flag.priced = true
  flag.frames = false
})

describe("renderRuleVerdict on a video-fed Speaker View with unproduced face tracks", () => {
  it("R15: while video mode is not live, refuses with the video-mode sentence alone", () => {
    for (const [priced, frames] of [[true, false], [false, true]] as const) {
      flag.priced = priced
      flag.frames = frames
      expect(renderRuleVerdict("sv", nodes, edges), `${priced}/${frames}`).toEqual({ ok: false, issues: [SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE] })
    }
  })

  it("once video mode is live, says to run Speaker Frames first, as before", () => {
    flag.frames = true
    const verdict = renderRuleVerdict("sv", nodes, edges)
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.issues).toContain(SPEAKER_VIEW_TRACKS_UNPRODUCED_MESSAGE)
    expect(verdict.ok === false && verdict.issues).not.toContain(SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE)
  })

  it("R15: a video wired whose producer has not run yet is refused with the same sentence, not \"no edit\"", () => {
    const unrun = nodes.map((n) => (n.id === "up" ? node("up", "generate-video", { generatedResults: [] }) : n))
    expect(renderRuleVerdict("sv", unrun, edges)).toEqual({ ok: false, issues: [SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE] })
    // Once video mode is live there is still nothing to judge: no edit, as before.
    flag.frames = true
    expect(renderRuleVerdict("sv", unrun, edges)).toEqual({ ok: false, issues: [NO_EDL] })
  })
})
