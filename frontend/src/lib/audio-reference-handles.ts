import { hasFeature } from "@nodaro/shared/model-catalog"
import { audioSoundtrackActive } from "@nodaro/shared/models"
import { countRefModalityEdges } from "@nodaro/shared/workflow"

const AUDIO_REFS = { label: "Audio Refs" } as const
const VOICE_REFS = { label: "Voice Refs" } as const

/**
 * The name of a video node's `audioReferences` pip for its model. A model that
 * takes each clip as a voice sample and makes its own sound (catalog feature
 * `voice-references`, Kling 4.0) calls it "Voice Refs" — unless the run plays
 * the first clip as its soundtrack (`audio-soundtrack`, on by default), when
 * the clip is heard as it is and the pip stays "Audio Refs". The node's pip and
 * the connect popover both name it through here.
 */
export function audioReferencesLabel(provider: string | undefined, audioSoundtrack: boolean | undefined): string {
  if (!provider || !hasFeature(provider, "voice-references")) return AUDIO_REFS.label
  return hasFeature(provider, "audio-soundtrack") && audioSoundtrack !== false ? AUDIO_REFS.label : VOICE_REFS.label
}

/**
 * Whether a video generation node's run sends a reference video: one wired on
 * a reference-video handle, or a Kling 4.0 soundtrack (its first audio clip,
 * sent as one — `audioSoundtrackActive`). Either moves its price to the
 * reference-video ladder, exactly as the run reserves.
 */
export function sendsReferenceVideo(
  nodeId: string,
  provider: string | undefined,
  audioSoundtrack: boolean | undefined,
  edges: ReadonlyArray<{ readonly target: string; readonly targetHandle?: string | null }>,
): boolean {
  if (countRefModalityEdges(edges, nodeId, "video") > 0) return true
  return audioSoundtrackActive({ provider, audioSoundtrack, audioRefCount: countRefModalityEdges(edges, nodeId, "audio") })
}
