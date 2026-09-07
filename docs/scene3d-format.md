# Scene3D composition format

A Scene3D composition uses `planType: "3d-scene"` and an explicit `schemaVersion`.
Discover supported authoring versions through `GET /v1/3d-scene/capabilities`;
optional engines depend on the deployment's configuration.

Version 1 describes primitive geometry and sparse object/camera keyframes.
Its existing interpretation and limits remain unchanged. Version 2 adds
retained GLB geometry, semantic entities, dense camera tracks and contiguous
shot ranges. Both use meters, a right-handed Y-up world and zero-based frames.

The shared package exports `Scene3DPlanV1`, `Scene3DPlanV2`, their respective
schemas, and the `Scene3DPlan` union. Use `scene3DAnyPlanSchema` to accept both
versions. The legacy `scene3DPlanSchema` remains a version-1 validator.

A v2 asset reference contains an opaque `assetId`, kind, role, byte length and
SHA-256 digest. It contains no storage credentials or transport URL. The reader
requires the exact referenced bytes and refuses missing, oversized or changed
assets before drawing. Playback loads geometry and camera data; native source
files are a separate download capability.

GLB node transforms are authoritative for exported geometry. Semantic entities
address named roots and material roles for selection and editing. Every editable
material role must name a material within that entity's geometry. Clay shading
preserves each material's base color, so changing a vehicle's body paint leaves
its tires unchanged. A dense
camera sidecar supplies position, quaternion and projection for every frame;
the reader preserves those values, including roll and exact shot cuts. Animation
is sampled from the requested frame so backward scrubbing and independent frame
rendering produce the same pose.

V2 supports deterministic transform, material-color, visibility and shot-camera
offsets as immutable overlays. An edit creates a new revision with a parent
revision and a new content digest. It leaves the base geometry and camera bytes
intact, enforces entity locks, and rejects stale revision/content expectations.
Derived posters, validation reports and native downloads must be regenerated
for the edited revision before being attached to it.

The browser and MP4 composition use the same Three.js reader. Version 2 currently
accepts clay geometry and rigid animation; textured, skinned or morph-target
assets are rejected. Limits include 100 semantic entities, 2,000 mesh nodes,
200,000 triangles, 32 shots and 64 MiB of playback assets. The shared schema
also bounds timing, dimensions, hierarchy depth and manifest size.
