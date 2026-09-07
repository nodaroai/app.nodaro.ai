---
"@nodaro/shared": major
---

Add the Scene3D v2 wire contract: a strict discriminated `Scene3DPlan = Scene3DPlanV1 | Scene3DPlanV2` keyed on `schemaVersion`, GLB-backed semantic entities with anchors and material-role bindings, opaque asset references with SHA-256 digests, explicit contiguous shots, a dense one-sample-per-frame camera sidecar with perspective-projection validation, deterministic overlays, provenance and a canonical revision content hash — plus admission and post-decode resource gates.

V1 parsing is unchanged: same fields, same limits, same messages. `Scene3DPlan` is now the union, so a consumer that reads v1-specific fields must first narrow with `isScene3DPlanV1` / `isScene3DPlanV2`; `scene3DPlanSchema` remains a v1-only deprecated alias of `scene3DPlanV1Schema`.
