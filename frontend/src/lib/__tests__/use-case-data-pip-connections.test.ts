// @test-watches frontend/src/nodes/**
import { describe, expect, it } from "vitest"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { UNIT_NODE_DEFINITIONS } from "@/lib/unit-definitions"
import { isValidWorkflowConnection, usecaseDataPipRefused } from "@/lib/connection-validation"
import { usecaseHandsOnEpisode } from "@/components/editor/workflow-editor/use-case-io"

/**
 * A use-case node's data pip — its plan (`json`), its text — is not its
 * episode: it connects where JSON or text is taken, never into an input that
 * takes only media (Trim Audio's `in`, Generate Image's `references`). The
 * validator reads the pip, not just the node's type: the node is a
 * video-or-audio producer for its episode only. Every other wire is judged as
 * it was (the episode pip below, and the data pips into JSON and text inputs).
 */
const accepts = (sourceType: string, sourceHandle: string | null, targetType: string, targetHandle: string) =>
  isValidWorkflowConnection({ source: "s", target: "t", sourceHandle, targetHandle }, (id) => (id === "s" ? sourceType : id === "t" ? targetType : undefined))

const MEDIA_ONLY: ReadonlyArray<readonly [string, string]> = [
  ["trim-audio", "in"], ["combine-audio", "in"], ["audio-fx", "in"], ["mix-audio", "in"], ["adjust-volume", "in"], ["merge-video-audio", "in"],
  ["trim-video", "in"], ["combine-videos", "in"], ["loop-video", "in"], ["extract-audio", "in"], ["add-captions", "in"],
  ["generate-image", "references"], ["generate-video", "imageReferences"], ["generate-video", "videoReferences"], ["generate-video", "audioReferences"],
  ["image-overlay", "overlay"], ["face-swap", "face"], ["slideshow", "images"], ["apply-edl", "sources"], ["episode-chapters", "media"], ["tighten-episode", "music"],
]
const DATA_INPUTS: ReadonlyArray<readonly [string, string]> = [
  ["apply-edl", "edl"], ["speaker-view", "edl"], ["extract-field", "in"], ["json-process", "in"],
  ["generate-image", "prompt"], ["llm-chat", "prompt"], ["combine-text", "text"], ["text-prompt", "in"], ["social-media-format", "text"],
]

describe("a use-case node's json pip connects by the pip, not the node type", () => {
  it.each(MEDIA_ONLY)("Tighten Episode json → %s.%s is refused", (t, h) => {
    expect(accepts("tighten-episode", "json", t, h)).toBe(false)
    expect(usecaseDataPipRefused("tighten-episode", "json", t, h)).toBe(true)
  })

  it.each(MEDIA_ONLY)("Tighten Episode's episode (media) → %s.%s is judged as before", (t, h) => {
    // The episode is video or audio: every media input that took it still does.
    expect(usecaseDataPipRefused("tighten-episode", "media", t, h)).toBe(false)
    expect(usecaseDataPipRefused("tighten-episode", null, t, h)).toBe(false)
  })

  it.each(DATA_INPUTS)("Tighten Episode json → %s.%s is still accepted", (t, h) => {
    expect(accepts("tighten-episode", "json", t, h)).toBe(true)
  })

  it("the episode pip into an audio-only input is still accepted (never vacuous)", () => {
    expect(accepts("tighten-episode", "media", "trim-audio", "in")).toBe(true)
    expect(accepts("tighten-episode", null, "combine-videos", "in")).toBe(true)
  })

  it("every use-case unit's data pips reach no audio-only or video-only `in`", () => {
    const units = UNIT_NODE_DEFINITIONS.filter((u) => u.execution.kind === "use-case")
    expect(units.length).toBeGreaterThanOrEqual(2)
    const mediaIns = NODE_DEFINITIONS.map((d) => d.type as string).filter((t) => ["trim-audio", "combine-audio", "audio-fx", "trim-video", "combine-videos", "extract-audio", "loop-video", "resize-video"].includes(t))
    expect(mediaIns.length).toBe(8)
    const wired: string[] = []
    for (const u of units) {
      for (const o of u.handles.outputs) {
        if (usecaseHandsOnEpisode(u.type, o.id)) continue
        for (const t of mediaIns) if (accepts(u.type, o.id, t, "in")) wired.push(`${u.type}.${o.id} → ${t}.in`)
      }
    }
    expect(wired).toEqual([])
  })
})
