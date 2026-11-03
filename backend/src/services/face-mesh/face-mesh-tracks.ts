/**
 * Which found faces get lines: only a face that stays — pure.
 *
 * The landmark model rates some crops a face for a frame or two: a tiny face
 * far back in a wide shot, a dark gap between two people, a passenger half
 * hidden. A run with no size or zone filter would draw each of them, and on a
 * blurred depth map a mesh that lasts a frame or two reads as a solid object,
 * which a video model then renders as one. So a face gets lines ONLY when it
 * is found in at least `FACE_MESH_MIN_FOUND_FRAMES` frames of its track:
 *   - FOUND: it passes the filters (`faceGetsMesh`: the mask, the size
 *     limits, the zone) and the landmark model's presence is at least
 *     `FACE_MESH_MIN_PRESENCE`;
 *   - its TRACK: found faces at the same place in frames at most
 *     `FACE_MESH_TRACK_MAX_APART` apart. Each frame's found faces are matched
 *     to the tracks found in the frames just before (within that many) by box
 *     overlap — the smoothing's own match (`matchFaceBoxes`: greedy, best
 *     overlap first, at least `FACE_MESH_TRACK_MIN_IOU`), so the faces this
 *     rule tells apart are the ones the smoothing tells apart — and a face
 *     with no match starts a track.
 * A face found in fewer frames of its track is never drawn, on any frame. A
 * face missed for one frame stays in its track and keeps its lines on the
 * frames it is found; missed for two, it starts a new track, drawn once that
 * one is found in enough frames.
 *
 * The drawer streams (`FaceMeshLookahead`): a frame is decided once the
 * `FACE_MESH_LOOKAHEAD_FRAMES` frames after it are linked — a track short of
 * the count by then never reaches it (its next find would come more than
 * `FACE_MESH_TRACK_MAX_APART` frames after its last) — so each frame is held
 * that many frames, then drawn and written in order, none added or dropped.
 */
import type { FaceBox } from "./face-mesh-filters.js"
import { matchFaceBoxes } from "./face-mesh-smooth.js"

/** A face is drawn only when it is found in at least this many frames of its track. */
export const FACE_MESH_MIN_FOUND_FRAMES = 3
/** A track links found faces in frames at most this many apart (one frame missed between two finds). */
export const FACE_MESH_TRACK_MAX_APART = 2
/**
 * The frames linked after a frame before it is decided: found at n, n + 2 and
 * n + 4 is the latest a face found at n can reach the count.
 */
export const FACE_MESH_LOOKAHEAD_FRAMES = (FACE_MESH_MIN_FOUND_FRAMES - 1) * FACE_MESH_TRACK_MAX_APART

/** A track of found faces: the frames it has been found in so far (it only grows). */
export interface FoundTrack {
  readonly found: number
}

interface OpenTrack {
  box: FaceBox
  last: number
  found: number
}

/** A clip's found faces linked into tracks, frame by frame, in order. */
export class FoundFaceTracks {
  private open: OpenTrack[] = []
  private frame = -1

  /** The next frame's found faces (their boxes); returns each one's track, in `boxes`' order. */
  link(boxes: readonly FaceBox[]): FoundTrack[] {
    const frame = ++this.frame
    // A track last found more than FACE_MESH_TRACK_MAX_APART frames ago is over for good.
    const open = this.open.filter((t) => frame - t.last <= FACE_MESH_TRACK_MAX_APART)
    const trackOf = matchFaceBoxes(boxes, open.map((t) => t.box))
    const started: OpenTrack[] = []
    const linked = boxes.map((box, i) => {
      const j = trackOf[i]!
      const track = j >= 0 ? open[j]! : { box, last: frame, found: 0 }
      if (j < 0) started.push(track)
      track.box = box
      track.last = frame
      track.found++
      return track
    })
    this.open = [...open, ...started]
    return linked
  }
}

/** The whole clip: for each frame, whether each of its found faces (in the frame's order) is drawn. */
export function facesToDraw(frames: readonly (readonly FaceBox[])[]): boolean[][] {
  const tracks = new FoundFaceTracks()
  const linked = frames.map((boxes) => tracks.link(boxes))
  return linked.map((ts) => ts.map((t) => t.found >= FACE_MESH_MIN_FOUND_FRAMES))
}

/** A decided frame: what was held with it, and the faces drawn on it (in the order they were found). */
export interface DecidedFrame<T, F> {
  readonly item: T
  readonly drawn: readonly F[]
}

/**
 * The drawer's stream: each frame goes in with what it holds (`item`) and its
 * found faces, and comes out once, in order, as soon as it is decided —
 * `FACE_MESH_LOOKAHEAD_FRAMES` frames later, or at the clip's end (`flush`) —
 * with the faces drawn on it. It decides exactly as `facesToDraw` over the
 * whole clip.
 */
export class FaceMeshLookahead<T, F extends { readonly box: FaceBox }> {
  private readonly tracks = new FoundFaceTracks()
  private queue: ReadonlyArray<{ readonly item: T; readonly found: readonly F[]; readonly tracks: readonly FoundTrack[] }> = []

  /** The frames held now: at most `FACE_MESH_LOOKAHEAD_FRAMES` between calls. */
  get held(): number {
    return this.queue.length
  }

  /** The next frame; returns the frame it decides (the one `FACE_MESH_LOOKAHEAD_FRAMES` before it), once there is one. */
  push(item: T, found: readonly F[]): DecidedFrame<T, F>[] {
    this.queue = [...this.queue, { item, found, tracks: this.tracks.link(found.map((f) => f.box)) }]
    return this.release(FACE_MESH_LOOKAHEAD_FRAMES)
  }

  /** The clip's end: every frame still held, decided, in order. */
  flush(): DecidedFrame<T, F>[] {
    return this.release(0)
  }

  private release(keep: number): DecidedFrame<T, F>[] {
    const out = this.queue.slice(0, Math.max(0, this.queue.length - keep)).map(({ item, found, tracks }) => ({
      item,
      drawn: found.filter((_, i) => tracks[i]!.found >= FACE_MESH_MIN_FOUND_FRAMES),
    }))
    this.queue = this.queue.slice(out.length)
    return out
  }
}
