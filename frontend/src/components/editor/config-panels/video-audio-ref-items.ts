import { referenceModalityForHandle, type ReferenceModality } from "@nodaro/shared"
import type { RefImageItem } from "./tag-textarea"
import type { SourceNodeInfo } from "./types"

/**
 * Builders for the `{video:N}` / `{audio:N}` autocomplete items — the video /
 * audio siblings of `toRefImageItems(buildVideoRefAutocomplete(...))` in
 * `video-configs.tsx`. Kept in this neutral module (NOT in video-configs.tsx)
 * because the shared `usePromptEditorRefs` hook consumes them, and video-configs
 * already imports that hook — defining the builders here breaks what would
 * otherwise be a circular import. video-configs re-exports them so callers (and
 * the Task 3.1 test) still import from `../video-configs`.
 *
 * A source belongs to a modality iff the shared single-source-of-truth
 * `referenceModalityForHandle(targetHandle)` returns that modality. This is the
 * EXACT predicate the backend resolver, the FE preview, and the FE run path use
 * to count `{video:N}` / `{audio:N}` tokens — so editor token N maps 1:1 to the
 * backend `referenceVideoUrls` / `referenceAudioUrls` slot N. It resolves BOTH
 * the legacy single-name ids (`reference-videos` / `reference-audio`) and the
 * canonical Generate Video ids (`videoReferences` / `audioReferences`), so the
 * numbering never drifts across handle aliases.
 *
 * Numbering restarts at 1 per modality, independent of image numbering and of
 * the other modality — `{video:1}`, `{video:2}`, `{audio:1}`, ….
 */

/** Best-effort media URL off a wired source's node data (display-only — drives
 *  the autocomplete row thumbnail; the {video:N}/{audio:N} token mapping is
 *  positional, not URL-based, so a stale/empty URL never desyncs the slot). */
function mediaUrl(nd: Record<string, unknown>, modality: ReferenceModality): string {
  if (modality === "video") {
    return (
      (nd.generatedVideoUrl as string) ||
      (nd.videoUrl as string) ||
      (nd.url as string) ||
      ""
    )
  }
  return (
    (nd.generatedAudioUrl as string) ||
    (nd.audioUrl as string) ||
    (nd.url as string) ||
    ""
  )
}

function buildVideoRefMediaAutocomplete(
  sources: ReadonlyArray<SourceNodeInfo>,
  modality: "video" | "audio",
): RefImageItem[] {
  const out: RefImageItem[] = []
  for (const s of sources) {
    if (referenceModalityForHandle(s.targetHandle) !== modality) continue
    const nd = s.nodeData ?? {}
    out.push({
      url: mediaUrl(nd, modality),
      label: s.label || s.type,
      // RefImageItem.source extended with "video" | "audio"; the editor's `@`
      // suggestion command inserts a videoRef / audioRef atomic node for these.
      source: modality,
      // Independent 1..N counter per modality (out.length is the count so far).
      index: out.length + 1,
      // Label-less by default → a clean `{video:N}` / `{audio:N}` token. Users
      // pick a role ("clip", "music", …) from the pill's swap menu afterward.
      defaultLabel: "",
    })
  }
  return out
}

/** Numbered `{video:N}` autocomplete items for the node's reference-VIDEO handles. */
export function buildVideoRefVideoAutocomplete(
  sources: ReadonlyArray<SourceNodeInfo>,
): RefImageItem[] {
  return buildVideoRefMediaAutocomplete(sources, "video")
}

/** Numbered `{audio:N}` autocomplete items for the node's reference-AUDIO handles. */
export function buildVideoRefAudioAutocomplete(
  sources: ReadonlyArray<SourceNodeInfo>,
): RefImageItem[] {
  return buildVideoRefMediaAutocomplete(sources, "audio")
}
