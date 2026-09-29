/**
 * How a recast render packs scenes into parts — the values `segmentSec` takes
 * on `POST /v1/recast`, `/v1/recast/estimate` and `/v1/recast/:id/start`. A
 * name, not seconds, despite the field's name:
 *
 * - `"scenes-max"` (Long): whole scenes grouped into as few parts as fit, the
 *   fewest seams.
 * - `"scenes"` (Short): whole scenes in shorter parts.
 * - `"max"`: the longest parts the model allows, not grouped by scene.
 */
export const RECAST_SEGMENT_PACKS = ["max", "scenes-max", "scenes"] as const

export type RecastSegmentPack = (typeof RECAST_SEGMENT_PACKS)[number]
