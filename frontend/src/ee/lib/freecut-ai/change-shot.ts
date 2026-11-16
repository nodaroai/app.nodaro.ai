/**
 * A stretch of a laid-out video shown another way, because a person chose so:
 * the whole picture, one person, or parts, and who is in front. Pure: it reads
 * the timeline as the editor reports it and the face tracks the layout was
 * made from, and says which clips to copy, which copies to drop, and how each
 * clip is cropped and placed. Nothing moves in time.
 */
import type { TimelineView } from "./edit-plan"
import { laidVideo, type LayoutRow } from "./layout-rows"
import { BACKDROP_BLUR, chosenFraming, peopleOfPiece, placementOps, shotsOf, type ShotFraming, type ShotTrackSet, type ShownAs } from "./shot-layout"
import type { SpeakerLayout } from "./speaker-layout"

export interface ShotChoice {
  readonly as: ShownAs
  /** Who is in front, counted from the left of the picture. */
  readonly first: number
}

type Op = Record<string, unknown>
type Framed = Pick<ShotFraming, "kind" | "slots" | "regions" | "backdrop">

export interface ShotChangePlan {
  /** Clips to copy, one editor request per list: a clip that needs two more copies is in two lists. */
  readonly copy: ReadonlyArray<readonly string[]>
  /** The rest of the edits, once the copies exist (`copiesOf`: the new copies of each footage clip, in the order made). */
  readonly place: (copiesOf: ReadonlyMap<string, readonly string[]>) => Op[]
}

/** The most people seen at once in a stretch of the laid-out video: how many can be told apart there. */
export function peopleInRow(view: Pick<TimelineView, "items" | "tracks" | "fps">, row: LayoutRow, set: ShotTrackSet): number {
  const shots = shotsOf(set)
  const moments = (laidVideo(view)?.moments ?? []).filter((m) => m.footage.from >= row.from && m.footage.from < row.to)
  return Math.max(0, ...moments.map((m) => peopleOfPiece(m.footage, shots, view.fps).length))
}

/**
 * The plan that shows `row` as chosen. A moment with too few people for the
 * parts asked for is left as it is. `nameOf`: what the timeline calls a clip
 * framed this way. Null when no video is laid out, or nothing would change.
 */
export function planShotChange(view: TimelineView, row: LayoutRow, choice: ShotChoice, set: ShotTrackSet, layout: SpeakerLayout, nameOf?: (framing: Framed) => string | undefined): ShotChangePlan | null {
  const laid = laidVideo(view)
  const media = view.media?.find((m) => m.id === laid?.mediaId)
  if (!laid || view.width === undefined || view.height === undefined) return null
  const canvas = { width: view.width, height: view.height }
  const source = media?.width && media?.height ? { width: media.width, height: media.height } : canvas
  const shots = shotsOf(set)
  const changes = laid.moments
    .filter((m) => m.footage.from >= row.from && m.footage.from < row.to)
    .flatMap((moment) => {
      const framing = chosenFraming(choice.as, peopleOfPiece(moment.footage, shots, view.fps), choice.first, layout, canvas, source)
      return framing ? [{ moment, framing, need: framing.slots.length - 1 }] : []
    })
  if (changes.length === 0) return null
  const rounds = Math.max(0, ...changes.map((c) => c.need - c.moment.copies.length))
  const copy = Array.from({ length: rounds }, (_, k) => changes.filter((c) => c.need - c.moment.copies.length > k).map((c) => c.moment.footage.id))
  return {
    copy,
    place: (copiesOf) => {
      const dropped = changes.flatMap((c) => c.moment.copies.slice(c.need).map((i) => i.id))
      const sharp = changes.filter((c) => !c.framing.backdrop).map((c) => c.moment.footage.id)
      const soft = changes.filter((c) => c.framing.backdrop).map((c) => c.moment.footage.id)
      return [
        ...(dropped.length > 0 ? [{ op: "removeItems", ids: dropped }] : []),
        ...changes.flatMap((c) => placementOps(c.framing, [c.moment.footage.id, ...c.moment.copies.slice(0, c.need).map((i) => i.id), ...(copiesOf.get(c.moment.footage.id) ?? [])], source, canvas, nameOf?.(c.framing))),
        ...(sharp.length > 0 ? [{ op: "blurItems", ids: sharp, radius: 0 }] : []),
        ...(soft.length > 0 ? [{ op: "blurItems", ids: soft, radius: BACKDROP_BLUR }] : []),
      ]
    },
  }
}
