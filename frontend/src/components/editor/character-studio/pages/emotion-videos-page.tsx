import type { StudioPageProps } from "../../studio-shell/types"
import type { CharacterStudioState } from "../use-character-studio"
import type { CharacterStudioJobs } from "../use-character-studio-jobs"

/**
 * Emotion videos page — read-only display of the character's reference video
 * clips per emotion (the `reference_videos_by_variant` JSONB column,
 * migration 192), mirroring the "Emotion videos" tab of studio.nodaro.ai's
 * character page. Data is hydrated by `getCharacter` →
 * `staged.referenceVideosByVariant` (a `Record<emotion, url[]>`); this page only
 * renders + plays it (no generation/upload/voice-TTS — that's the "display
 * first" scope).
 */
export function EmotionVideosPage({ state }: StudioPageProps<CharacterStudioState, CharacterStudioJobs>) {
  const byEmotion = state.staged.referenceVideosByVariant ?? {}
  const emotions = Object.entries(byEmotion)
    .map(([emotion, urls]) => [emotion, (urls ?? []).filter(Boolean)] as const)
    .filter(([, urls]) => urls.length > 0)

  if (emotions.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-3 py-6 text-center">
        <p className="text-sm text-muted-foreground">No emotion videos yet.</p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Reference clips recorded per emotion in the studio appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-6 overflow-y-auto p-4">
      {emotions.map(([emotion, urls]) => (
        <section key={emotion}>
          <h3 className="mb-2 text-sm font-medium capitalize text-foreground">
            {emotion}
            <span className="ml-1.5 text-xs text-muted-foreground">({urls.length})</span>
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {urls.map((url, i) => (
              <video
                key={`${url}-${i}`}
                src={url}
                controls
                playsInline
                preload="metadata"
                className="w-full rounded-md border border-border bg-[#1a1d27]"
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
