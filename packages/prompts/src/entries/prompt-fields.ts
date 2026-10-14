/**
 * `@nodaro/prompts/prompt-fields` — Node prompt fields, prompt resolution, hint joining/shedding, send-text rule, audio tags.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/prompts`.
 */
export * from "../prompt-hint-join.js"
export * from "../hint-shedding.js"
export * from "../hint-join.js"
export * from "../resolve-prompt.js"
export { stripAudioTags } from "../audio-tags.js"
export * from "../node-prompt-fields.js"
// --- What a text-requiring node would send (the orchestrator's empty-input skip reads it) ---
export * from "../node-send-text.js"
