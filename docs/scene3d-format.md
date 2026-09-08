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

When an optional authoring engine consumes an existing GLB, the host checks
access to its exact source revision and verifies the immutable asset receipt
before issuing a short-lived download grant. The destination job must still be
active and authorized. Grants use private storage and reject changed objects;
they are transport credentials and are never part of the scene plan. Engine
support for imported inputs remains a separate capability.

The host also resolves an input selector before a job exists, for quote and
admission validation. Only the source revision and artifact IDs are accepted;
the host supplies the digest and byte length after checking permissions and
private storage. It checks access again after storage IO. This metadata lookup
creates no job or download grant, and callers cannot supply a URL or receipt.

Authored revisions can retain private copies of their construction inputs.
Those copies belong to the saved revision's owner and remain pinned through
manual edits, so rebuilding does not depend on the original import revision.
They are excluded from playback assets and public download lanes; the
authoring engine can read them only with current edit access to the revision.

An entity anchor has a stable `name` and a `position` in entity-local space.
For an asset visual, an optional `nodeName` binds the anchor to a raw GLB node
name inside that entity's own root. Its position and optional rotation then
use that node's local coordinates and follow the node's animation, ancestors
and manual entity transforms. For example, `{ "name": "door.tip", "nodeName":
"car/door.hinge", "position": [1, 0, 0] }` attaches a point one local meter along
the hinge's X axis. Missing nodes and bindings into a nested child entity are
rejected before playback. Primitive and group anchors remain entity-local.
The shared Three.js handle's `getAnchorWorldPosition(entityId, anchorName)`
returns the point at the most recently applied frame and fails for unknown
anchors. Authoring support for creating these bindings depends on the engine.

GLB node transforms are authoritative for exported geometry. Semantic entities
address named roots and material roles for selection and editing. Every editable
material role must name a material within that entity's geometry. Clay shading
preserves each material's base color, so changing a vehicle's body paint leaves
its tires unchanged. An entity may
declare a parent. A parented entity's exported root is nested inside its
parent's root and its node transform is relative to it, so the parent's
placement and baked animation reach the child through the file itself. The
reader requires the plan and the file to describe the same parentage and
refuses one where they disagree. Ownership still stops at a nested child:
geometry, materials and selection belong to the entity that declares them, so
recoloring a parent never reaches an entity nested inside it. A parent entity
may own no geometry at all: an organizational root carries a baked, possibly
animated transform for the entities nested inside it, and the reader accepts it
so long as something is nested there. A dense
camera sidecar supplies position, quaternion and projection for every frame;
the reader preserves those values, including roll and exact shot cuts. Animation
is sampled from the requested frame so backward scrubbing and independent frame
rendering produce the same pose.

An entity's optional `visible` boolean records its baked visibility; omission
means `true`. Hidden geometry stays loaded and its animation keeps sampling, so
a visibility overlay can show it immediately. An overlay takes precedence over
the base value; removing that overlay restores the baked value. A hidden parent
also hides its descendants. Hidden objects do not intercept clicks in the preview;
use the entity list to select and show them. Base visibility is part of the
revision content digest.

V2 supports deterministic transform, material-color, visibility and shot-camera
offsets as immutable overlays. A transform overlay applies above the baked
placement of the entity and of its ancestors, and its declared `space` says in
which frame its values are read. `local` names the entity's own parent frame,
baked placement included, so the values are a constant there and the edit
travels with a moving parent. `world` names the scene's axes: the values are the
entity's world position, rotation and scale, and the reader divides the parent's
world out once at each frame, so a rotated, scaled or animated ancestor changes
where the entity ends up but never what the numbers mean. Under such an ancestor
a `world` edit is therefore not one constant; the entity stays parented and
keeps its own baked animation, and only the channels the edit names are held.
The one combination neither end can express is an ancestor with non-uniform
scale under a rotation, which leaves a transform that is not a
position/rotation/scale at all; the reader refuses it rather than approximate.
A visibility overlay hides the entity and, as in any scene graph, everything
nested inside it; each entity's own visibility is unchanged by an ancestor's, so
showing the ancestor again restores exactly the descendants that were not
hidden in their own right. An edit creates a new revision with a parent
revision and a new content digest. It leaves the base geometry and camera bytes
intact, enforces entity locks, and rejects stale revision/content expectations.
Derived posters, validation reports and native downloads must be regenerated
for the edited revision before being attached to it.

The browser and MP4 composition use the same Three.js reader. Version 2 currently
accepts clay geometry and rigid animation; textured, skinned or morph-target
assets are rejected. Limits include 100 semantic entities, 2,000 mesh nodes,
200,000 triangles, 32 shots and 64 MiB of playback assets. The shared schema
also bounds timing, dimensions, hierarchy depth and manifest size.
