/**
 * A trend's clip preparation (pure): how its source clip is made ready before
 * the video model sees it (`faceMasking.source`, the server's
 * backend/src/lib/cast-swap-face-masking.ts rules).
 *
 * - Faces hidden (`"faces"`, also when left out): today's face mask, with
 *   every setting of its own.
 * - Full depth: the whole clip becomes one depth video. Only `mode` applies,
 *   and it is always "always" (made once, approved, stored).
 * - Keep people: the people stay as filmed and the rest becomes depth. Every
 *   setting but the fill applies; the mask covers the whole person by default
 *   ("body", its own target), and a box may mark the main character.
 *
 * The server refuses a depth mode without "always", the whole-person target
 * outside Keep people and a main character box outside it: switching modes
 * here never leaves the draft in one of those states.
 */
import type { AdminTrendFaceMasking, AdminTrendFaceMaskingSource, AdminTrendFaceMaskingTarget } from "@/lib/api"

export const CLIP_PREPARATIONS: ReadonlyArray<{ value: AdminTrendFaceMaskingSource; label: string; hint: string }> = [
  {
    value: "faces",
    label: "Faces hidden",
    hint: "The faces in the clip are covered before the video model sees it (the settings below).",
  },
  {
    value: "full-depth",
    label: "Full depth",
    hint: "The whole clip becomes one depth video the model follows for the movement; the looks come from the slots' pictures. Made once, approved and stored: every run uses it.",
  },
  {
    value: "keep-people",
    label: "Keep people",
    hint: "The people stay as filmed and the rest of the frame becomes depth. Made once, approved and stored: every run uses it.",
  },
]

/** The admin's name for a clip preparation. */
export function clipPreparationName(source: string): string {
  return CLIP_PREPARATIONS.find((c) => c.value === source)?.label ?? source
}

/** How the setting prepares the clip; left out = Faces hidden. */
export function clipPreparationOf(m: Pick<AdminTrendFaceMasking, "source"> | undefined): AdminTrendFaceMaskingSource {
  return m?.source ?? "faces"
}

/** Full depth and Keep people: the clip is made once in depth, approved and stored. */
export function isDepthPreparation(source: AdminTrendFaceMaskingSource): boolean {
  return source !== "faces"
}

/** What the mask covers when the target is left out: the whole person in Keep people, else the head. */
export function defaultTargetFor(source: AdminTrendFaceMaskingSource): AdminTrendFaceMaskingTarget {
  return source === "keep-people" ? "body" : "head"
}

/**
 * The setting prepared another way (a new object; undefined stays undefined
 * for Faces hidden, the default). A depth mode is mode "always". Leaving Keep
 * people drops what only it takes: the whole-person target, and the main
 * character boxes (`removedMain` counts them, for the screen to say so).
 */
export function withClipPreparation(
  m: AdminTrendFaceMasking | undefined,
  source: AdminTrendFaceMaskingSource,
): { masking: AdminTrendFaceMasking | undefined; removedMain: number } {
  if (!m && source === "faces") return { masking: undefined, removedMain: 0 }
  const { source: _was, ...rest } = m ?? { mode: "always" as const }
  const next: AdminTrendFaceMasking = isDepthPreparation(source) ? { ...rest, mode: "always", source } : { ...rest }
  // The scene source is Full depth's alone.
  if (source !== "full-depth") delete next.scene
  let removedMain = 0
  if (source !== "keep-people") {
    if (next.target === "body") delete next.target
    if (next.marks) {
      const kept = next.marks.filter((mark) => mark.label !== "main")
      removedMain = next.marks.length - kept.length
      if (kept.length > 0) next.marks = kept
      else delete next.marks
    }
  }
  return { masking: next, removedMain }
}

/** What the server would refuse in the clip preparation, as sentences (Save is held on any). */
export function clipPreparationIssues(m: AdminTrendFaceMasking): string[] {
  const out: string[] = []
  const source = clipPreparationOf(m)
  if (isDepthPreparation(source) && m.mode !== "always") out.push(`Clip preparation: ${clipPreparationName(source)} runs every time (mode Always).`)
  if (source !== "keep-people" && m.target === "body") out.push("Clip preparation: the whole person is covered in Keep people only.")
  const main = (m.marks ?? []).filter((mark) => mark.label === "main").length
  if (source !== "keep-people" && main > 0) {
    out.push(`Face masking: ${main} box${main === 1 ? " marks" : "es mark"} the main character, which only Keep people takes. Remove ${main === 1 ? "it" : "them"} first (6. Face masking).`)
  }
  return out
}
