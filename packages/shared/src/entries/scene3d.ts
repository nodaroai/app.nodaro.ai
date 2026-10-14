/**
 * `@nodaro/shared/scene3d` — Scene3D previsualization wire contract, 3D Render Pro and render pricing shape.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/shared`.
 */
// --- Scene3D previsualization (v1): the frozen wire contract shared by the
//     authoring LLM jobs, the Three.js/Remotion renderer, the canvas and the
//     SDK/MCP surface. Structure only — no prompts, no pricing. ---
export * from "../scene3d.js"
export * from "../scene3d-edit.js"
export * from "../scene3d-v2.js"
export * from "../scene3d-v2-plan.js"
export * from "../scene3d-v2-resources.js"
export * from "../scene3d-camera-track.js"
// --- What an authoring run says about its own answer: assumptions, summary,
//     repair count. Additive and optional on every Scene3D authoring lane. ---
export * from "../scene3d-delivery-notes.js"
// --- 3D Render Pro: one durable operation, scene + video in one result ---
export * from "../pro-3d-render.js"
// --- Scene3D render pricing: which frame-size tier a render settles at.
//     The SHAPE of the price (tier, multiplier, identifier); never a rate. ---
export * from "../scene3d-render-pricing.js"
export * from "../scene3d-v2-edit.js"
export * from "../scene3d-authoring-engine.js"
export * from "../scene3d-input-assets.js"
