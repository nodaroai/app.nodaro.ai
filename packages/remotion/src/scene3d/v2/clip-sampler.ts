/**
 * Deterministic GLB animation sampling — WITHOUT `AnimationMixer`.
 *
 * `AnimationMixer` is a stateful integrator: it advances by a delta, and
 * `clampWhenFinished` / `paused` mean an action that has run to its end stops
 * responding to a smaller time. Remotion renders frames out of order, a user
 * scrubs backwards, and the Player pauses — all three would then produce a
 * different pose for the same frame number. `mixer.setTime()` papers over part
 * of that and still leaves the finished-action edge case.
 *
 * So this module binds each track ONCE (`PropertyBinding`) and evaluates its
 * `Interpolant` at the clip-local time on every sample. The evaluation is a
 * pure function of the time value: frame 400 then frame 12 gives exactly what
 * frame 12 alone gives, and a fresh build gives the same again. Interpolants
 * clamp at their endpoints, which is the hold-first/hold-last semantics v1
 * already has.
 */
import * as THREE from "three"
import { check } from "./errors"
import { SCENE3D_RENDERER_GLB_LIMITS } from "./limits"

interface BoundTrack {
  readonly binding: THREE.PropertyBinding
  readonly interpolant: { evaluate(time: number): unknown }
  readonly trackName: string
}

export interface Scene3DBoundClip {
  readonly name: string
  readonly trackCount: number
  /** Apply the clip's pose for `timeSeconds`. Order-independent by construction. */
  apply(timeSeconds: number): void
  dispose(): void
}

/**
 * Bind the tracks of `clip` that address nodes inside `root`.
 *
 * `root` is the entity's mounted EXPORTED root, never its wrapper: baked
 * animation belongs to the exported nodes, and `PropertyBinding.findNode`
 * resolves a track to the binding root itself when the names match.
 *
 * `allowedNodeNames` must be the MOUNTED object names (post-sanitize,
 * post-dedupe) of this entity's subtree — `AnimationClip` track paths are built
 * from `object.name`, so raw glTF names would match nothing.
 */
export function bindScene3DClip(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
  allowedNodeNames: ReadonlySet<string>,
  subject: string,
): Scene3DBoundClip {
  const bound: BoundTrack[] = []

  for (const track of clip.tracks) {
    const parsed = THREE.PropertyBinding.parseTrackName(track.name)
    const nodeName = parsed.nodeName
    // A track with no node name would bind to the BINDING ROOT itself rather
    // than to a node it names. A GLB clip never legitimately does that, so it
    // is a malformed clip rather than something to silently apply.
    check(
      !!nodeName,
      "SCENE_ASSET_BINDING",
      `animation track "${track.name}" names no node; it would bind to the entity's root`,
      subject,
    )
    // One whole-scene clip carries tracks for EVERY entity in the file. Each
    // entity binds only the tracks inside its own mounted subtree, which is
    // what keeps one channel to exactly one owner.
    if (!allowedNodeNames.has(nodeName)) continue

    const node = THREE.PropertyBinding.findNode(root, nodeName)
    check(
      !!node,
      "SCENE_ASSET_BINDING",
      `animation track "${track.name}" targets node "${nodeName}", which is not in this entity's subtree`,
      subject,
    )

    const binding = new THREE.PropertyBinding(root, track.name, parsed)
    binding.bind()
    const interpolant = track.createInterpolant() as unknown as { evaluate(time: number): unknown }
    bound.push({ binding, interpolant, trackName: track.name })
  }

  check(
    bound.length <= SCENE3D_RENDERER_GLB_LIMITS.maxAnimationTracks,
    "SCENE_RESOURCE_LIMIT",
    `${bound.length} bound animation tracks exceeds the limit of ${SCENE3D_RENDERER_GLB_LIMITS.maxAnimationTracks}`,
    subject,
  )

  return {
    name: clip.name,
    trackCount: bound.length,
    apply(timeSeconds: number) {
      // No accumulation, no "since last frame": every track is evaluated at the
      // absolute time, so the pose depends on `timeSeconds` and nothing else.
      const time = Number.isFinite(timeSeconds) ? timeSeconds : 0
      for (const entry of bound) {
        const values = entry.interpolant.evaluate(time) as ArrayLike<number>
        entry.binding.setValue(values as unknown as number[], 0)
      }
    },
    dispose() {
      for (const entry of bound) entry.binding.unbind()
      bound.length = 0
    },
  }
}

/**
 * Pick the clip an entity asks for.
 *
 * A named clip that does not exist is a binding FAILURE rather than a silent
 * fallback to clip 0 — "the car does not move" is far harder to notice in a
 * 720-frame render than a load error.
 */
export function selectScene3DClip(
  clips: readonly THREE.AnimationClip[],
  requested: string | undefined,
  subject: string,
): THREE.AnimationClip | null {
  if (requested !== undefined) {
    const found = clips.find((clip) => clip.name === requested)
    check(
      !!found,
      "SCENE_ASSET_BINDING",
      `animation clip "${requested}" is not in this asset (available: ${clips.map((c) => c.name).join(", ") || "none"})`,
      subject,
    )
    return found as THREE.AnimationClip
  }
  if (clips.length === 0) return null
  // Exactly one clip is unambiguous; more than one needs the manifest to say.
  check(
    clips.length === 1,
    "SCENE_ASSET_BINDING",
    `this asset has ${clips.length} animation clips, so the entity must name one`,
    subject,
  )
  return clips[0]
}
