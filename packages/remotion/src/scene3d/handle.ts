/**
 * The interface `Scene3DCanvas` drives, satisfied by both the v1 and the v2
 * scene builders.
 *
 * The canvas is the ONE component the browser preview and the Remotion export
 * share, so it must not know which schema version it is drawing — it asks for a
 * frame and gets pixels. Keeping this contract narrow is what lets v2 add
 * assets, baked cameras and shots without a second canvas, a second WebGL
 * lifecycle, or a second set of `delayRender` bugs.
 */
import type * as THREE from "three"

/** Three raycasting ignores visibility, including hidden ancestors. Match drawing. */
export function raycastVisibleSceneObjects(raycaster: THREE.Raycaster, targets: THREE.Object3D[]) {
  return raycaster.intersectObjects(targets, true).filter(({ object }) => {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
      if (!node.visible) return false
    }
    return true
  })
}

export interface Scene3DRenderHandle {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  /** One representative mesh per selectable id (kept for v1 callers). */
  readonly meshes: Map<string, THREE.Mesh>
  /**
   * What the canvas raycasts against. In v2 one entity owns many meshes, so
   * this is not `meshes.values()`; every target carries
   * `userData.objectId = <entity id>` so a hit maps back to the SEMANTIC
   * entity rather than to whichever Blender mesh happened to be in front.
   */
  readonly raycastTargets: THREE.Object3D[]
  /** Apply the deterministic state of `frame`. */
  applyFrame(frame: number): unknown
  setSelected(ids: readonly string[]): void
  dispose(): void
}
