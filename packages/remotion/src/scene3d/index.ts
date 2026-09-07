/**
 * `@nodaro/remotion/scene3d` — the render-runtime-free entry point.
 *
 * Importing this path pulls three.js and React only; `remotion` is NOT in the
 * graph, so the editor can embed the preview without the render runtime.
 * Use `Scene3DRenderer` from the package root when you want the Remotion
 * composition (it reads `useCurrentFrame()`).
 */
export { Scene3DCanvas } from "./scene3d-canvas"
export type { Scene3DCanvasProps } from "./scene3d-canvas"

export {
  buildScene3DScene,
  buildScene3DGeometry,
  type Scene3DSceneHandle,
} from "./scene-builder"

export {
  sampleScene3DFrame,
  sampleScene3DObject,
  sampleScene3DCamera,
  focalLengthToVerticalFovDeg,
  scene3DFrameCount,
  type Scene3DFrameSample,
  type Scene3DObjectSample,
  type Scene3DCameraSample,
  type Scene3DTransformSample,
} from "./sampler"

export type {
  Scene3DPlan,
  Scene3DObject,
  Scene3DReference,
  Scene3DCamera,
  Scene3DLighting,
  Scene3DPrimitive,
  Scene3DObjectKeyframe,
  Scene3DCameraKeyframe,
  Scene3DEasing,
  Vec3,
} from "./types"
export { DEFAULT_SENSOR_WIDTH_MM } from "./types"
export { SCENE3D_DEFAULT_PLAN } from "./default-plan"
