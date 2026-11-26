/**
 * Deterministic Scene3D frame sampler — re-exported from its home in
 * `@nodaro/render-rules/scene3d-sampler`, where the server's plan check reads
 * the same function before a plan is accepted. The preview, the export and
 * that check therefore place every object and the camera identically.
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
} from "@nodaro/render-rules/scene3d-sampler"
