import { describe, it, expect } from "vitest"
import { NODE_DEF_MAP, type SceneNodeType } from "@/types/nodes"
import { VIDEO_PRODUCER_HANDLE_LABELS } from "../video-producer-handles"
import { IMAGE_PRODUCER_HANDLE_LABELS } from "../image-producer-handles"
import { AUDIO_TEXT_HANDLE_LABELS } from "../audio-text-handles"
import { IDENTITY_HANDLE_LABELS } from "../identity-handles"
import { GENERATE_VIDEO_INPUT_HANDLES } from "../generate-video-handles"
import { GENERATE_IMAGE_INPUT_HANDLES } from "../generate-image-handles"
import { VIDEO_RETAKE_HANDLE_IDS } from "../video-retake-handles"
import { TARGET_HANDLE_ACCEPTS } from "../target-handle-registry"

/**
 * Drift guard for the "stale NODE_DEFINITIONS.inputs" bug class.
 *
 * Custom-handle nodes render their input handles from a per-node constant or a
 * typed validator, NOT from NODE_DEFINITIONS.inputs — so `.inputs` was hand-
 * maintained and repeatedly drifted into a stale SUBSET (Connect dialog drops
 * wiring directions) or a PHANTOM (`["in"]` / `["video-in"]` for handles the
 * node never renders → node-compatibility.resolveTargetHandle wires an orphan
 * edge). This asserts `.inputs` EXACTLY equals the node's rendered input-handle
 * set so it can't regress.
 *
 * Source of truth: the *-_HANDLE_LABELS maps (keys = the input handle ids the
 * source-direction popover renders) + the *_INPUT_HANDLES / *_HANDLE_IDS
 * constants. Three label-map entries disagree with the node's validator +
 * component and are overridden (the Map's later entries win):
 *   - ai-avatar / cinematic-avatar — the label maps list a phantom "video" the
 *     validators reject and the nodes don't render; dropped.
 *   - voice-changer — the label map omits "video", but the validator accepts it
 *     and the node renders a video input (dual-mode revoice); added.
 */
const labelEntries = (m: Record<string, Record<string, string>>) =>
  Object.entries(m).map(([type, handles]) => [type, Object.keys(handles)] as const)

const AUTHORITATIVE = new Map<string, readonly string[]>([
  ...labelEntries(VIDEO_PRODUCER_HANDLE_LABELS),
  ...labelEntries(IMAGE_PRODUCER_HANDLE_LABELS),
  ...labelEntries(AUDIO_TEXT_HANDLE_LABELS),
  ...labelEntries(IDENTITY_HANDLE_LABELS),
  ["generate-video", [...GENERATE_VIDEO_INPUT_HANDLES]],
  ["generate-image", [...GENERATE_IMAGE_INPUT_HANDLES]],
  ["video-retake", [...VIDEO_RETAKE_HANDLE_IDS]],
  ["video-sfx", ["prompt", "negative", "video"]],
  // validator/component overrides — see header.
  ["ai-avatar", ["image", "script", "audio"]],
  ["cinematic-avatar", ["prompt", "ref-video", "ref-audio", "ref-image"]],
  ["voice-changer", ["audio", "video"]],
])

describe("NODE_DEFINITIONS.inputs equals each node's rendered input-handle set", () => {
  it.each([...AUTHORITATIVE.entries()])("%s.inputs has no stale subset or phantom", (type, handles) => {
    const def = NODE_DEF_MAP.get(type as SceneNodeType)
    // edit-image / image-to-image have validators + label entries but no
    // creatable node definition (legacy; modify-image supersedes them).
    if (!def) return
    expect([...def.inputs].sort()).toEqual([...handles].sort())
  })
})

/**
 * Completeness guard for `TARGET_HANDLE_ACCEPTS` (target-handle-registry.ts).
 *
 * That map powers the source-direction "Connect" popover candidate list and the
 * reverse-drag glow (`getTargetHandlesAccepting`). It drifted incomplete: some
 * typed-handle nodes were absent entirely, others registered only SOME of their
 * rendered input handles — so dragging from a producer's output pip silently
 * omitted a valid consumer handle. (Drop-to-connect still works via the separate
 * drop validator in connection-validation.ts, so the symptom is degraded
 * discoverability, not a connectivity bug.)
 *
 * Invariant: for every node that renders typed input handles,
 * `TARGET_HANDLE_ACCEPTS[type]` exists and its set of `handleId`s is a SUPERSET
 * of the node's rendered input-handle set.
 *
 * Superset (not exact-equal) because a node MAY legitimately register extra
 * discoverable handles — every analyzable picker gets a `picker-json` target
 * appended by the registry loop — but it must never register FEWER handles than
 * it renders.
 *
 * Authoritative rendered-handle source: the SAME `AUTHORITATIVE` map used by the
 * NODE_DEFINITIONS.inputs guard above (the *_HANDLE_LABELS maps +
 * GENERATE_*_INPUT_HANDLES + VIDEO_RETAKE_HANDLE_IDS + the validator/component
 * overrides), PLUS three nodes that own a validator + render typed inputs but
 * have no *_HANDLE_LABELS entry:
 *   - audio-separation  — single `audio` target (7 stem handles are SOURCES).
 *   - voice-changer-pro — `audio` + `video` targets (dual-mode revoice clone of
 *     voice-changer; reuses isValidVoiceChangerConnection).
 *   - describe-to-picker — single `image` target (its `picker-json` is a SOURCE).
 */
const TARGET_HANDLE_AUTHORITATIVE = new Map<string, readonly string[]>([
  ...AUTHORITATIVE,
  ["audio-separation", ["audio"]],
  ["voice-changer-pro", ["audio", "video"]],
  ["describe-to-picker", ["image"]],
])

describe("TARGET_HANDLE_ACCEPTS registers a superset of every node's rendered input handles", () => {
  it.each([...TARGET_HANDLE_AUTHORITATIVE.entries()])(
    "%s — popover candidates cover all rendered input handles",
    (type, rendered) => {
      const entries = TARGET_HANDLE_ACCEPTS[type]
      const registered = new Set((entries ?? []).map((e) => e.handleId))
      const missing = [...rendered].filter((h) => !registered.has(h)).sort()
      expect(
        missing,
        entries
          ? `TARGET_HANDLE_ACCEPTS["${type}"] is missing rendered handle(s): ${missing.join(", ")}`
          : `TARGET_HANDLE_ACCEPTS["${type}"] is absent entirely — node renders: ${[...rendered].join(", ")}`,
      ).toEqual([])
    },
  )
})
