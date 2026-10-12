import { isSeedanceDraftCapable } from "@nodaro/shared"
import type { mergeVideoAudio } from "../providers/video/merge-video-audio.js"

/**
 * Seedance draft → 1080p finalize, the AUDIO half (decided 2026-10-12).
 *
 * Some drafts were muxed after the provider rendered them: the Generate Video
 * route's `audioUrl` merge, and the voiced lane's synthesised dialogue track
 * (Seedance renders those silent — the track only drives the lip motion). The
 * finalize re-renders the PICTURE at 1080p; the provider knows nothing of a
 * mux we did afterwards. So the finalize re-applies the SAME mux — same audio
 * source, same settings, same timing — to the 1080p render, at no extra
 * provider cost. The recipe is read from the SOURCE draft job, never the
 * request.
 *
 * Pure (recipes, validation, source lookup); the ffmpeg half that applies a
 * recipe lives in `seedance-draft-audio-apply.ts`.
 *
 * A draft records its recipe at completion as `output_data.draftAudioMux`
 * (an object, or `null` = nothing was muxed). A draft that predates the
 * recording but was muxed falls back to copying the audio stream of the stored
 * draft file onto the 1080p picture.
 */
export type DraftAudioMux =
  /** `/v1/generate-video` `audioUrl`: mixed over the clip's own audio. */
  | {
      readonly kind: "audio-track"
      readonly audioUrl: string
      readonly voiceoverVolume: number
      readonly backgroundVolume: number
      readonly keepOriginalAudio: boolean
    }
  /** Voiced lane (audio-driven): the synthesised dialogue track replaces the (silent) audio. */
  | { readonly kind: "voice-track"; readonly audioUrl: string }
  /** Legacy fallback: the stored draft's own (muxed) audio stream, copied onto the 1080p picture. */
  | { readonly kind: "copy-draft-audio"; readonly draftVideoUrl: string }

/** The Generate Video route's audio merge settings — ONE recipe for the draft and its finalize. */
export function generateVideoAudioMergeRecipe(audioUrl: string, generateAudio: boolean | undefined): DraftAudioMux {
  return { kind: "audio-track", audioUrl, voiceoverVolume: 100, backgroundVolume: 30, keepOriginalAudio: generateAudio ?? false }
}

/** The voiced lane's voice-track mux — ONE recipe for the draft and its finalize. */
export function voiceTrackMuxRecipe(audioUrl: string): DraftAudioMux {
  return { kind: "voice-track", audioUrl }
}

/** The `mergeVideoAudio` options a recipe stands for. */
export type DraftAudioMergeArgs = Parameters<typeof mergeVideoAudio>[0]

/**
 * A recipe → its exact `mergeVideoAudio` arguments: ONE builder for the
 * draft-time muxes (the i2v handler's Generate Video audio merge, the voiced
 * lane's voice track) and the finalize's re-apply onto the 1080p render, so
 * the two can never mix the audio differently.
 */
export function draftAudioMuxMergeArgs(videoUrl: string, mux: DraftAudioMux): DraftAudioMergeArgs {
  switch (mux.kind) {
    case "audio-track":
      return {
        videoUrl,
        audioUrl: mux.audioUrl,
        voiceoverVolume: mux.voiceoverVolume,
        backgroundVolume: mux.backgroundVolume,
        keepOriginalAudio: mux.keepOriginalAudio,
      }
    case "voice-track":
      return { videoUrl, audioTracks: [{ url: mux.audioUrl, startTime: 0, volume: 100, sourceType: "audio" }], keepOriginalAudio: false }
    case "copy-draft-audio":
      return { videoUrl, audioTracks: [{ url: mux.draftVideoUrl, startTime: 0, volume: 100, sourceType: "video" }], keepOriginalAudio: false }
  }
}

/**
 * The `extraOutputData` entry a completing run records: for a Seedance DRAFT,
 * `draftAudioMux` = the mux applied after the provider rendered it, or `null`
 * when none was (a recorded `null` tells the finalize "nothing to re-apply",
 * where a missing key means "an older draft — infer it"). Nothing for any
 * other run.
 */
export function draftAudioMuxOutputData(
  draft: unknown,
  provider: string | undefined,
  mux: DraftAudioMux | undefined,
): { draftAudioMux?: DraftAudioMux | null } {
  return draft === true && isSeedanceDraftCapable(provider) ? { draftAudioMux: mux ?? null } : {}
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)

/** A stored recipe, validated (never trusts the shape of a JSON column). */
export function readDraftAudioMux(v: unknown): DraftAudioMux | undefined {
  if (!v || typeof v !== "object") return undefined
  const r = v as Record<string, unknown>
  if (r.kind === "audio-track" && str(r.audioUrl)) {
    return {
      kind: "audio-track",
      audioUrl: r.audioUrl as string,
      voiceoverVolume: typeof r.voiceoverVolume === "number" ? r.voiceoverVolume : 100,
      backgroundVolume: typeof r.backgroundVolume === "number" ? r.backgroundVolume : 30,
      keepOriginalAudio: r.keepOriginalAudio === true,
    }
  }
  if (r.kind === "voice-track" && str(r.audioUrl)) return voiceTrackMuxRecipe(r.audioUrl as string)
  if (r.kind === "copy-draft-audio" && str(r.draftVideoUrl)) return { kind: "copy-draft-audio", draftVideoUrl: r.draftVideoUrl as string }
  return undefined
}

/**
 * The mux a finalize of this draft must re-apply, read from the SOURCE job.
 * Recorded recipe first (`null` = the draft was not muxed); a draft without
 * the record that was evidently muxed (a voice applied, or an `audioUrl` on
 * the request) copies the stored draft's audio; anything else gets none.
 */
export function draftAudioMuxForSource(
  input: Record<string, unknown>,
  output: Record<string, unknown>,
): DraftAudioMux | undefined {
  if ("draftAudioMux" in output) return readDraftAudioMux(output.draftAudioMux)
  const stored = str(output.videoUrl)
  const muxed = output.voiceApplied === true || str(input.audioUrl) !== undefined
  return muxed && stored ? { kind: "copy-draft-audio", draftVideoUrl: stored } : undefined
}
