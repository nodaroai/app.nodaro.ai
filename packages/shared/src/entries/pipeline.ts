/**
 * `@nodaro/shared/pipeline` — Director/studio pipeline types, events, defaults and validation; scene node types; voices; studio sequencing.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/shared`.
 */
export * from "../pipeline-chat.js"
export * from "../pipeline-defaults.js"
export * from "../pipeline-events.js"
export * from "../pipeline-state-types.js"
export * from "../pipeline-types.js"
export * from "../pipeline-validation.js"
export * from "../voice-matcher-types.js"
export * from "../voices.js"
export * from "../character-voice.js"
export * from "../entity-approval-types.js"
export * from "../image-critic-types.js"
export * from "../image-critic-node.js"
export * from "../scene-node-types.js"
export * from "../scene-helper-types.js"
// --- transient studio keys — the public share read strips them ---
export {
  STUDIO_TRANSIENT_KEYS,
  STUDIO_SHOT_TRANSIENT_KEYS,
  STUDIO_SHOT_DRAFT_KEYS,
  STUDIO_TAKE_VOICE_KEYS,
  STUDIO_PREVIZ_RUN_STATE_KEYS,
  stripStudioTransientSettings,
  stripStudioDraftSettings,
  stripStudioDraftWorkflow,
  stripStudioTakeVoiceRecords,
  STUDIO_TAKE_SEQUENCE_KEYS,
  STUDIO_SEQUENCE_PLANNING_KEYS,
  STUDIO_SEQUENCE_UNIT_REVIEW_KEYS,
  STUDIO_SEQUENCE_POLICY_KEYS,
  STUDIO_SEQUENCE_UNIT_MANIFEST_KEYS,
  STUDIO_KEYFRAME_NODE_TRANSIENT_KEYS,
  STUDIO_KEYFRAME_TRANSIENT_KEYS,
  STUDIO_KEYFRAME_REVIEW_KEYS,
  STUDIO_KEYFRAME_ACCEPTANCE_PRIVATE_KEYS,
} from "../studio-transient.js"
export { STUDIO_DEPENDENT_FRAMES_CAPABILITY, SequenceExecutionRequiredError, requiresSequenceExecution, assertCanvasExecutionAllowed } from "../sequence-execution"
