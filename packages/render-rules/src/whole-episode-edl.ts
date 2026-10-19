/**
 * The recordings of one conversation as ONE edit on the master clock
 * (decided 2026-10-17): what Speaker Layout cuts on two or more recordings,
 * where there is no plan. Every recording a source (offsets as measured,
 * roles set), one segment over the master's whole length, the picture on the
 * wide shot (else the first camera) — Camera Switch then splits it at the
 * turns. Pure; never throws.
 */
import type { Edl, EdlSource } from "@nodaro/shared/edl"

export interface WholeEpisodeEdlSource { readonly id: string; readonly url: string; readonly kind: "video" | "audio"; readonly durationMs: number; readonly offsetMs?: number; readonly speakers?: readonly string[] }

export function wholeEpisodeEdl(input: {
  readonly sources: readonly WholeEpisodeEdlSource[]
  readonly masterSourceId?: string
  readonly wideSourceId?: string
}): { readonly edl: Edl } | { readonly problem: string } {
  const videos = input.sources.filter((s) => s.kind === "video" && s.id !== input.masterSourceId)
  if (videos.length === 0) return { problem: "There is no recording with picture to show." }
  const clock = input.sources.find((s) => s.id === input.masterSourceId) ?? input.sources[0]!
  if (!(clock.durationMs > 0)) return { problem: "The master recording's length is not known." }
  const sources: EdlSource[] = input.sources.map((s) => ({
    id: s.id, url: s.url, kind: s.id === input.masterSourceId ? "audio" : s.kind,
    ...(s.offsetMs ? { offsetMs: Math.round(s.offsetMs) } : {}),
    // A sound-only recording that is not the master (a separate microphone) is
    // no one's camera, so it gets no role (decided 2026-10-19).
    ...(s.id === input.masterSourceId ? { role: "master-audio" } : s.id === input.wideSourceId ? { role: "wide" } : s.kind === "audio" ? {} : { role: "camera" }),
    ...(s.speakers && s.speakers.length > 0 ? { speakers: [...s.speakers] } : {}),
  }))
  const picture = videos.find((v) => v.id === input.wideSourceId) ?? videos[0]!
  return { edl: { version: 1, clock: "master", sources, segments: [{ id: "whole", inMs: 0, outMs: Math.round(clock.durationMs), video: picture.id }] } }
}
