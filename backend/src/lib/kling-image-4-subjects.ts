/**
 * Kling Image 4.0's named subjects: a wired character whose run sends 2 to 4
 * of its images goes to the provider as ONE named subject (KIE `elements`:
 * `name`, its views with the primary first, `tag`, `description`), called by
 * name in the prompt (`@Name`), as Kling 4.0 video does. A character that
 * sends one image stays a reference image.
 *
 * WHY HERE, AT PLAN TIME. A subject is priced as one input item whatever its
 * views (decided 2026-11-22), so the price must see the grouping: the route's
 * credit CHECK, its planner (the DEBIT) and the workflow payload builder all
 * call {@link klingImage4Subjects} on the same assembled reference list, and
 * the planner records the subjects on the job, so the provider sends exactly
 * what was priced. The provider never re-derives them (it has no character
 * data), and a recovery never needs them (the task was already sent).
 *
 * The views are the images the run ALREADY sends, grouped by the character
 * they came from (`characterSlug` on the structured reference): a subject
 * adds no image and drops none, it only names some of them. Each view still
 * counts against the request's image limit (10), so a run never sends more
 * images than it would without subjects.
 */
import { klingImage4ItemsFromSubjects } from "@nodaro/shared/model-catalog"
import {
  KLING_IMAGE_4_SUBJECT_DESCRIPTION_MAX,
  KLING_IMAGE_4_SUBJECT_MAX_VIEWS,
  KLING_IMAGE_4_SUBJECT_MIN_VIEWS,
  isKlingImage4,
} from "@nodaro/shared/model-catalog"
import { kling4Name } from "../providers/kie/kling4.js"

/** What a run sends the provider as one named subject. */
export interface KlingImageSubject {
  readonly name: string
  /** 2 to 4 of the run's own images, the character's primary view first. */
  readonly imageUrls: readonly string[]
  readonly description?: string
}

/** The fields of a structured reference this reads (`ConnectedReference`). */
export interface SubjectSourceRef {
  readonly url?: unknown
  readonly defaultName?: unknown
  readonly characterSlug?: unknown
  readonly variantSlug?: unknown
  readonly bucket?: unknown
  readonly description?: unknown
  readonly characterCanonicalDescription?: unknown
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined)

/**
 * The named subjects a Kling Image 4.0 run sends, from its structured
 * references and the images it sends (`sentUrls`, in order). Empty on any
 * other model, with no structured references, or when no character sends two
 * images. A view past the fourth stays a plain reference image.
 */
export function klingImage4Subjects(
  provider: unknown,
  refs: readonly SubjectSourceRef[] | undefined,
  sentUrls: readonly string[] | undefined,
): KlingImageSubject[] {
  if (!isKlingImage4(provider) || !refs?.length || !sentUrls?.length) return []
  const sent = new Set(sentUrls)
  // Each sent image's character, by its first structured reference.
  const groups = new Map<string, { refs: SubjectSourceRef[]; urls: string[] }>()
  const claimed = new Set<string>()
  for (const ref of refs) {
    const url = str(ref.url)
    const slug = str(ref.characterSlug)
    if (!url || !slug || !sent.has(url) || claimed.has(url)) continue
    claimed.add(url)
    const group = groups.get(slug) ?? { refs: [], urls: [] }
    group.refs.push(ref)
    group.urls.push(url)
    groups.set(slug, group)
  }
  const subjects: KlingImageSubject[] = []
  const taken = new Set<string>()
  for (const group of groups.values()) {
    if (group.urls.length < KLING_IMAGE_4_SUBJECT_MIN_VIEWS) continue
    // The primary view first: the character's own portrait (no variant, no
    // asset bucket), then the rest in the order the run sends them.
    const order = (r: SubjectSourceRef) => (str(r.variantSlug) || str(r.bucket) ? 1 : 0)
    const ordered = group.refs
      .map((r, i) => ({ r, i }))
      .sort((a, b) => order(a.r) - order(b.r) || sentUrls.indexOf(str(a.r.url)!) - sentUrls.indexOf(str(b.r.url)!) || a.i - b.i)
      .map(({ r }) => r)
    const primary = ordered[0]!
    let name = kling4Name(str(primary.defaultName), `Character${subjects.length + 1}`)
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${name.slice(0, 20 - String(n).length)}${n}`
    taken.add(name.toLowerCase())
    const description = (str(primary.characterCanonicalDescription) ?? str(primary.description))?.slice(0, KLING_IMAGE_4_SUBJECT_DESCRIPTION_MAX)
    subjects.push({
      name,
      imageUrls: ordered.slice(0, KLING_IMAGE_4_SUBJECT_MAX_VIEWS).map((r) => str(r.url)!),
      ...(description ? { description } : {}),
    })
  }
  return subjects
}

/**
 * Where a request says which character each picture came from: its structured
 * `connectedReferences`, or, on a flat request (the editor's Run of one node,
 * which assembles the prompt itself), `referenceCharacters`, the same entries
 * the editor assembled from. Read only to group named subjects.
 */
export function subjectSourcesOf(body: { connectedReferences?: unknown; referenceCharacters?: unknown } | null | undefined): SubjectSourceRef[] | undefined {
  const from = Array.isArray(body?.connectedReferences) && body!.connectedReferences.length > 0
    ? body!.connectedReferences
    : body?.referenceCharacters
  // Read before validation too (the credit check): an entry that is not an object is no source.
  return Array.isArray(from) ? (from.filter((r) => r !== null && typeof r === "object") as SubjectSourceRef[]) : undefined
}

/**
 * The input items a run is priced on: the images it sends, each subject's
 * views counted once as its subject. `sentImages` is the run's own count
 * (`pricedSentImages`: a Generate Image base included).
 */
export function klingImage4PricedItems(sentImages: number, subjects: readonly KlingImageSubject[]): number {
  // The same count every estimate makes (`klingImage4EstimatedItems`).
  return klingImage4ItemsFromSubjects(sentImages, subjects.map((s) => s.imageUrls.length))
}
