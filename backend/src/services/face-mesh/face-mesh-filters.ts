/**
 * Which found faces get lines — pure.
 *
 * A face is drawn only when it passes every filter the request names:
 *   - inside the mask (`maskUrl`): its box's CENTRE lies on a white pixel of
 *     that frame's mask (> 127) — the mask is SAM's raw mask, which already
 *     leaves out the faces the masking setting's size limits and edge zones
 *     left out, so a real face the mask does not cover never gets lines;
 *   - at least `minFaceHeightPct` of the frame's height tall, and at most
 *     `maxFaceHeightPct` when that is above 0 (the face box's height);
 *   - its box's centre outside the zone's margins (`VideoMaskZone`, the same
 *     margins the mask's zone filter reads).
 * Boxes are YuNet's: top-left and size, fractions of the frame.
 */
import type { VideoMaskZone } from "@nodaro/shared/media"

export interface FaceBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface FaceMeshFilters {
  /** 0 = off. */
  readonly minFaceHeightPct: number
  /** 0 = off. */
  readonly maxFaceHeightPct: number
  /** null = off (`resolveVideoMaskZone`). */
  readonly zone: VideoMaskZone | null
}

/** A mask frame: one byte a pixel, `width × height`. */
export interface MaskFrame {
  readonly gray: Uint8Array
  readonly width: number
  readonly height: number
}

/** A mask pixel above this is covered. */
export const FACE_MESH_MASK_ON = 127

const centreOf = (b: FaceBox): readonly [number, number] => [b.x + b.w / 2, b.y + b.h / 2]

/** The face box's height is within the size limits. */
export function passesFaceSize(box: FaceBox, f: Pick<FaceMeshFilters, "minFaceHeightPct" | "maxFaceHeightPct">): boolean {
  const pct = box.h * 100
  if (f.minFaceHeightPct > 0 && pct < f.minFaceHeightPct) return false
  if (f.maxFaceHeightPct > 0 && pct > f.maxFaceHeightPct) return false
  return true
}

/** The face box's centre is inside the zone's inner rectangle (no zone: anywhere). */
export function passesZone(box: FaceBox, zone: VideoMaskZone | null): boolean {
  if (!zone) return true
  const [cx, cy] = centreOf(box)
  return (
    cx >= zone.leftPct / 100 &&
    cx <= 1 - zone.rightPct / 100 &&
    cy >= zone.topPct / 100 &&
    cy <= 1 - zone.bottomPct / 100
  )
}

/** The face box's centre lies on a covered pixel of the mask frame (a centre off the frame is clamped onto its edge). */
export function centreInMask(box: FaceBox, mask: MaskFrame): boolean {
  const [cx, cy] = centreOf(box)
  const px = Math.min(mask.width - 1, Math.max(0, Math.floor(cx * mask.width)))
  const py = Math.min(mask.height - 1, Math.max(0, Math.floor(cy * mask.height)))
  return mask.gray[py * mask.width + px]! > FACE_MESH_MASK_ON
}

/** Every filter: size, zone, and — when a mask frame is given — the mask. */
export function faceGetsMesh(box: FaceBox, f: FaceMeshFilters, mask: MaskFrame | undefined): boolean {
  return passesFaceSize(box, f) && passesZone(box, f.zone) && (!mask || centreInMask(box, mask))
}
