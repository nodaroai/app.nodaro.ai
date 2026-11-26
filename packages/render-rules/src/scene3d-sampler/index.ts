/**
 * `@nodaro/render-rules/scene3d-sampler` — where a Scene3D v1 plan puts every
 * object and the camera at a frame.
 *
 * Its own entry, not part of the package root: the Remotion renderer, the
 * editor's preview and the server's plan check import it, and none of them
 * should load the rest of the package to do so. Pure math over the plan; no
 * `three`, no DOM, no clock.
 */
export {
  SCENE3D_CAMERA_FAR,
  SCENE3D_CAMERA_NEAR,
  focalLengthToVerticalFovDeg,
  sampleScene3DCamera,
  sampleScene3DFrame,
  sampleScene3DObject,
  scene3DFrameCount,
  type Scene3DCameraSample,
  type Scene3DFrameSample,
  type Scene3DObjectSample,
  type Scene3DTransformSample,
} from "./sampler"
export { composeTRS, identityMat4, multiplyMat4, translationOf, type Mat4 } from "./matrix"
