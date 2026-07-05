/**
 * @nodaro/prompts — creative/prompt IP shared across backend and
 * frontend but deliberately EXCLUDED from the published Apache packages.
 * Never published to npm ("private": true); licensed with the repository
 * core under the root Nodaro Sustainable Use License.
 *
 * Placement rule (root CLAUDE.md): new prompt engineering, catalogs,
 * doctrine, and presets default to backend/ or here — packages/shared gets
 * only what the public API contract requires.
 */
export * from "./identity-lock.js"
export * from "./parameter-prompt-hint.js"
export * from "./entity-prompts.js"
export * from "./brand-tokens.js"
export * from "./prompt-builder.js"
export * from "./prompt-builder-structured-fields.js"
export * from "./video-reference-resolver.js"
export * from "./sound-aggregator.js"
export * from "./assemble-suno-input.js"
export * from "./assemble-image-input.js"
export * from "./seedance-2-inputs.js"
export * from "./person.js"
export * from "./picker-catalogs.js"
export * from "./picker-analyzer-registry.js"
