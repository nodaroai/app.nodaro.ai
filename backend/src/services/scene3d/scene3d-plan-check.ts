/**
 * What the contract cannot see: a scene that is VALID and shows nothing.
 *
 * `scene3DPlanSchema` refuses a plan that is malformed — a dangling parent, a
 * cycle, a keyframe past the end. It cannot refuse a well-formed plan that
 * renders an empty frame, and the authoring model writes those: a jet whose
 * parts were never parented to the group that flies it (the group moves, the
 * parts sit at their LOCAL offsets around the world origin), or a camera that
 * looks away from every subject for a whole shot. Both passed the contract
 * with zero revisions and were delivered — and billed — as finished scenes.
 *
 * This is the generate lane's second gate, after the contract: its findings go
 * back to the model as a revision, exactly like a contract refusal. It is NOT
 * part of the contract (`scene3DPlanV1Issues`): a stored plan with these
 * findings is still a plan the editor, Edit 3D Scene and the renderer must
 * open, so the rule lives where a NEW plan is accepted, and nowhere a plan is
 * read.
 *
 * Two findings, two severities, decided 2026-11-25:
 * - DETACHED PARTS is structural and certain (a group with nothing parented to
 *   it shows nothing and moves nothing), so it is BLOCKING: once the revisions
 *   are spent the run fails rather than hand on a broken scene to a render.
 * - A SHOT WITH NO SUBJECT is a geometric estimate (bounding spheres, no
 *   occlusion, a size floor), so it is ADVISORY: once the revisions are spent
 *   the scene is delivered with a warning instead of being thrown away.
 *
 * Where the camera is and where every object is at a frame comes from the
 * renderer's own sampler (`@nodaro/render-rules/scene3d-sampler`), with the
 * renderer's clip planes — so the check judges the frame the export draws.
 */
import {
  SCENE3D_CAMERA_FAR,
  SCENE3D_CAMERA_NEAR,
  sampleScene3DFrame,
  type Scene3DCameraSample,
  type Scene3DFrameSample,
  type Scene3DObjectSample,
} from "@nodaro/render-rules/scene3d-sampler"
import { SCENE3D_PARTS_DETACHED_CODE, SCENE3D_SHOT_WITHOUT_SUBJECT_CODE } from "@nodaro/render-rules"
import type { Scene3DObject, Scene3DPlanV1, Vec3 } from "@nodaro/shared/scene3d"

export { SCENE3D_PARTS_DETACHED_CODE, SCENE3D_SHOT_WITHOUT_SUBJECT_CODE }

/**
 * An object this large that never moves (it and every ancestor carry no
 * keyframes) is SCENERY — ground, mountains, a skyline — not what a shot is
 * about. A shot that frames only scenery while the scene has subjects is the
 * failure this check exists for.
 */
export const SCENE3D_BACKGROUND_MIN_EXTENT_M = 100

/** A subject counts as SEEN when its bounds span at least this share of the frame's height. */
export const SCENE3D_SUBJECT_MIN_FRAME_SHARE = 0.02

/** A run of camera frames shorter than this is a cut's seam, not a shot anyone sees. */
const MIN_SHOT_FRAMES = 3

/** How many loose parts one finding names. */
const MAX_NAMED_PARTS = 8

/** How many subjects a no-subject finding locates for the model. */
const NEAREST_SUBJECTS = 3

export interface Scene3DPlanFinding {
  readonly code: typeof SCENE3D_PARTS_DETACHED_CODE | typeof SCENE3D_SHOT_WITHOUT_SUBJECT_CODE
  /** blocking: never delivered while it stands. advisory: delivered with a warning once revisions are spent. */
  readonly severity: "blocking" | "advisory"
  /** Addressed to the authoring model, and readable by a person in a job's warnings. */
  readonly message: string
}

/** Every finding on a plan the contract already accepted, detached parts first. */
export function scene3DPlanFindings(plan: Scene3DPlanV1): Scene3DPlanFinding[] {
  return [...detachedPartsFindings(plan), ...shotFindings(plan)]
}

// ── detached parts ──────────────────────────────────────────────────────

function looseParts(group: Scene3DObject, objects: readonly Scene3DObject[]): Scene3DObject[] {
  return objects.filter((o) =>
    o !== group &&
    o.parentId === undefined &&
    [`${group.id}-`, `${group.id}_`, `${group.id}.`].some((prefix) => o.id.startsWith(prefix)))
}

function detachedPartsFindings(plan: Scene3DPlanV1): Scene3DPlanFinding[] {
  const parents = new Set(plan.objects.flatMap((o) => (o.parentId === undefined ? [] : [o.parentId])))
  return plan.objects.flatMap((group): Scene3DPlanFinding[] => {
    if (group.primitive !== "group" || parents.has(group.id)) return []
    const animated = (group.keyframes?.length ?? 0) > 0
    const parts = looseParts(group, plan.objects)
    if (!animated && parts.length === 0) return []
    const named = parts.slice(0, MAX_NAMED_PARTS).map((p) => `"${p.id}"`).join(", ")
    const more = parts.length > MAX_NAMED_PARTS ? ` and ${parts.length - MAX_NAMED_PARTS} more` : ""
    return [{
      code: SCENE3D_PARTS_DETACHED_CODE,
      severity: "blocking",
      message:
        `group "${group.id}" has nothing attached to it — no object names it as parentId` +
        `${animated ? ", yet its keyframes carry the motion" : ""}. A group has no geometry, so it shows nothing and moves nothing. ` +
        `Set parentId "${group.id}" on the parts it carries${parts.length > 0 ? ` (${named}${more} look like its parts)` : ""}, ` +
        `with each part's position, rotation and keyframes LOCAL to "${group.id}" (relative to the group, not the world).`,
    }]
  })
}

// ── shots without a subject ─────────────────────────────────────────────

/** The camera's cuts: a key one frame after the previous key starts a new shot. Inclusive [first, last] ranges. */
function cameraShots(plan: Scene3DPlanV1): Array<[number, number]> {
  const keys = [...(plan.camera.keyframes ?? [])].map((k) => k.frame).sort((a, b) => a - b)
  const starts = [0, ...keys.filter((frame, i) => i > 0 && frame - keys[i - 1] === 1 && frame > 0)]
  const unique = [...new Set(starts)]
  return unique.map((start, i): [number, number] => [start, (unique[i + 1] ?? plan.durationInFrames) - 1])
}

/** It, or an ancestor, carries keyframes. */
function moves(object: Scene3DObject, byId: ReadonlyMap<string, Scene3DObject>, seen = new Set<string>()): boolean {
  if ((object.keyframes?.length ?? 0) > 0) return true
  if (object.parentId === undefined || seen.has(object.id)) return false
  const parent = byId.get(object.parentId)
  return parent ? moves(parent, byId, new Set([...seen, object.id])) : false
}

/** World-space size of an object's geometry: its dimensions times its world scale. */
function worldExtent(object: Scene3DObject, sample: Scene3DObjectSample): Vec3 {
  const m = sample.worldMatrix
  const scale = [Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10])]
  return [object.dimensions[0] * scale[0], object.dimensions[1] * scale[1], object.dimensions[2] * scale[2]]
}

/** Radius of a sphere around the object's centre that holds all of its geometry (every primitive is built centred). */
function boundingRadius(object: Scene3DObject, extent: Vec3): number {
  return object.primitive === "sphere" ? Math.max(...extent) / 2 : Math.hypot(...extent) / 2
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(...a)
  return length > 0 ? [a[0] / length, a[1] / length, a[2] / length] : [0, 0, 0]
}

interface CameraBasis {
  readonly position: Vec3
  readonly forward: Vec3
  readonly right: Vec3
  readonly up: Vec3
  /** tan of half the vertical / horizontal field of view. */
  readonly tanV: number
  readonly tanH: number
}

/** The camera as `lookAt` orients it: Y up, looking from its position to its target. */
function cameraBasis(camera: Scene3DCameraSample, plan: Scene3DPlanV1): CameraBasis {
  const position = camera.position as Vec3
  const looking = unit(sub(camera.target as Vec3, position))
  const forward: Vec3 = Math.hypot(...looking) > 0 ? looking : [0, 0, -1]
  const side = cross(forward, [0, 1, 0])
  const right = Math.hypot(...side) > 1e-6 ? unit(side) : ([1, 0, 0] as Vec3)
  const up = cross(right, forward)
  const tanV = Math.tan(((camera.fovDeg * Math.PI) / 180) / 2)
  const aspect = plan.height > 0 ? plan.width / plan.height : 16 / 9
  return { position, forward, right, up, tanV, tanH: tanV * aspect }
}

/**
 * The bounding sphere reaches into the view frustum (between the clip planes,
 * inside all four side planes) and spans the minimum share of the frame — or
 * the camera is inside it, which fills the frame.
 */
function seenBy(basis: CameraBasis, center: Vec3, radius: number): boolean {
  const d = sub(center, basis.position)
  if (Math.hypot(...d) <= radius) return true
  const z = dot(d, basis.forward)
  if (z < SCENE3D_CAMERA_NEAR - radius || z > SCENE3D_CAMERA_FAR + radius) return false
  const halfH = Math.atan(basis.tanH)
  const halfV = Math.atan(basis.tanV)
  if (z * Math.sin(halfH) - Math.abs(dot(d, basis.right)) * Math.cos(halfH) < -radius) return false
  if (z * Math.sin(halfV) - Math.abs(dot(d, basis.up)) * Math.cos(halfV) < -radius) return false
  return radius / (Math.max(z, radius) * basis.tanV) >= SCENE3D_SUBJECT_MIN_FRAME_SHARE / 2
}

interface Subject {
  readonly id: string
  readonly center: Vec3
}

/** The non-scenery objects with geometry at `frame`, and whether the camera sees any of them. */
function subjectsAt(plan: Scene3DPlanV1, sample: Scene3DFrameSample, byId: ReadonlyMap<string, Scene3DObject>) {
  const basis = cameraBasis(sample.camera, plan)
  const subjects: Subject[] = []
  let seen = false
  for (const objectSample of sample.objects) {
    const object = byId.get(objectSample.id)
    if (!object || object.primitive === "group") continue
    const extent = worldExtent(object, objectSample)
    if (!moves(object, byId) && Math.max(...extent) >= SCENE3D_BACKGROUND_MIN_EXTENT_M) continue
    const center = objectSample.worldPosition as Vec3
    subjects.push({ id: object.id, center })
    if (!seen && seenBy(basis, center, boundingRadius(object, extent))) seen = true
  }
  return { basis, subjects, seen }
}

const round = (v: number): number => Math.round(v * 10) / 10
const at = (v: readonly number[]): string => `[${v.slice(0, 3).map(round).join(", ")}]`

function shotFindings(plan: Scene3DPlanV1): Scene3DPlanFinding[] {
  const byId = new Map(plan.objects.map((o) => [o.id, o]))
  // A scene with no subject at all (a landscape, a skyline) has nothing to miss.
  if (subjectsAt(plan, sampleScene3DFrame(plan, 0), byId).subjects.length === 0) return []
  const findings: Scene3DPlanFinding[] = []
  for (const [first, last] of cameraShots(plan)) {
    if (last - first + 1 < MIN_SHOT_FRAMES) continue
    const frames = [...new Set([first, Math.round((first + last) / 2), last])]
    const looks = frames.map((frame) => ({ frame, sample: sampleScene3DFrame(plan, frame) }))
      .map(({ frame, sample }) => ({ frame, sample, ...subjectsAt(plan, sample, byId) }))
    if (looks.some((look) => look.seen)) continue
    const middle = looks[Math.floor(looks.length / 2)]
    const camera = middle.sample.camera
    const nearest = [...middle.subjects]
      .sort((a, b) => Math.hypot(...sub(a.center, middle.basis.position)) - Math.hypot(...sub(b.center, middle.basis.position)))
      .slice(0, NEAREST_SUBJECTS)
      .map((s) => `"${s.id}" at ${at(s.center)}`)
      .join(", ")
    findings.push({
      code: SCENE3D_SHOT_WITHOUT_SUBJECT_CODE,
      severity: "advisory",
      message:
        `the camera shot over frames ${first}-${last} shows no subject: at frames ${frames.join(", ")} it sees only ` +
        `scenery (objects over ${SCENE3D_BACKGROUND_MIN_EXTENT_M} m that never move) or nothing at all. ` +
        `At frame ${middle.frame} the camera is at ${at(camera.position)} looking at ${at(camera.target)} ` +
        `with a ${round(camera.focalLengthMm)} mm lens; the nearest subjects are ${nearest} (world coordinates). ` +
        `Aim camera.target at the subject and place the camera so the subject is in frame for this shot, or move the subject into view.`,
    })
  }
  return findings
}
