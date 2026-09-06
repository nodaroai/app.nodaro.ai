/**
 * `@nodaro/studio-production` — the studio's production document, as code.
 *
 * A production is a Nodaro workflow whose `settings.studio` holds the shots.
 * Everything needed to READ, WRITE, VALIDATE and DESCRIBE that document lives
 * here and runs under plain node, so the platform's routes, its MCP tools and
 * its copilot operate on exactly the document the studio editor does — one
 * implementation, not two that agree until they do not.
 *
 * The surface is the set of modules the studio app imports today. Modules that
 * only ever served their own siblings (the `shot-graph-*` readers and writers,
 * the format's repair passes, the cast lookup) stay internal and are reached
 * through the barrel that owns them.
 */

// ── the document: shots, the graph, the plan, the cast, the trash ───────────

export * from "./beats"
export * from "./candidates"
export * from "./cast"
export * from "./cast-bundle"
export * from "./cast-keys"
export * from "./cast-mention-runs"
export * from "./cast-merge"
export * from "./cast-rebind"
export * from "./cast-rename"
export * from "./character-fx"
export * from "./composer-draft-types"
export * from "./connected-references"
export * from "./directing-references"
export * from "./direction"
export * from "./llm-structured-body"
export * from "./look-layers"
export * from "./look-pickers"
export * from "./mention-grammar"
export * from "./model-menu"
export * from "./music-options"
export * from "./prompt-mentions"
export * from "./recast"
export * from "./ref-source-kind"
export * from "./scene-plan"
export * from "./scene-prompt"
export * from "./scene-settings"
export * from "./shot"
export * from "./shot-direction"
export * from "./shot-graph"
export * from "./subject"
export * from "./subject-pickers"
export * from "./transition"
export * from "./trash"
export * from "./tts-provider"
export * from "./result-key"
export * from "./video-lane"
export * from "./voice-delivery-settings"
export * from "./view"
export * from "./voice-direction"
export * from "./workflow-like"

// ── the bundle: a frame / motion / scene / film as one JSON envelope ────────
export * from "./bundle/production-bundle"
export * from "./bundle/production-bundle-parse"
export * from "./bundle/production-bundle-strip"

// ── the `nodaro-studio-production` plan format and the skill it renders ─────
export * from "./format/audio"
export * from "./format/describe"
export * from "./format/export"
export * from "./format/generate"
export * from "./format/import"
export * from "./format/import-canonical-mentions"
export * from "./format/import-passages"
export * from "./format/import-repair-sound"
export * from "./format/json-schema"
export * from "./format/legend"
export * from "./format/registry"
export * from "./format/render-skill"
export * from "./format/schema"
export * from "./format/warnings"
