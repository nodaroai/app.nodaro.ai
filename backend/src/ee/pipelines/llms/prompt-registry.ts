/**
 * Registry for pipeline doctrine strings contributed by private plugins
 * (@nodaroai/cloud-plugins, film-studio-prompts). Populated once at boot by
 * `backend/src/lib/private-plugins/load.ts` (`registerPipelinePrompts()`,
 * called via dynamic import so core never statically imports `ee/` — same
 * shim pattern as `applyStaticCreditCosts()`). Every `run*()` wrapper across
 * `ee/pipelines/llms/**` calls `getPipelinePrompt(key)` INSIDE its function
 * body — never at module scope. A top-level `const X = getPipelinePrompt(...)`
 * would evaluate at import time, before `loadPrivatePlugins()` resolves during
 * boot (this module is transitively imported by app.ts/pipeline-worker.ts
 * before their async setup runs), and would throw in every process,
 * including a correctly-configured cloud deployment.
 *
 * Test environments never install the proprietary plugin package, so
 * `backend/src/test/setup.ts` registers a fixture `PromptTable` directly
 * (bypassing the loader) before any test runs — see that file's comment.
 */
const registry = new Map<string, string>()

export class PipelinePromptUnavailableError extends Error {
  constructor(public readonly key: string) {
    super(
      `Pipeline prompt '${key}' is unavailable — the film-studio prompt ` +
        `suite plugin isn't loaded in this deployment (PRIVATE_MODULES=optional, ` +
        `or @nodaroai/cloud-plugins failed to load, or this plugin version ` +
        `predates the film-studio-prompts plugin). This feature is unavailable.`,
    )
    this.name = "PipelinePromptUnavailableError"
  }
}

/** Additive merge — called once per loaded plugin at boot. */
export function registerPipelinePrompts(prompts: Record<string, string>): void {
  for (const [key, value] of Object.entries(prompts)) registry.set(key, value)
}

/** Throws PipelinePromptUnavailableError when absent — the hard guard. */
export function getPipelinePrompt(key: string): string {
  const value = registry.get(key)
  if (value === undefined) throw new PipelinePromptUnavailableError(key)
  return value
}

/** Side-effect-free check for pre-flight gates (createPipeline()). */
export function pipelinePromptsAvailable(): boolean {
  return registry.size > 0
}

/** Test-only reset. */
export function __resetPipelinePromptRegistryForTests(): void {
  registry.clear()
}

/**
 * Single source of truth for registry keys — both repos import/mirror this
 * list (app side: this file; plugin side: src/plugins/film-studio-prompts/
 * prompt-keys.ts, hand-synced like contract.ts). Prevents typo drift between
 * the 25 `getPipelinePrompt(...)` call sites and the plugin's `prompts()`
 * export — a key that exists on only one side fails loudly (unavailable
 * error / dead key) rather than silently.
 *
 * 25 entries, not 24 — `helperValidateMatchCut` (validate-match-cut.ts) is a
 * real static doctrine constant of the same shape as the other 24; the S9
 * design doc's own §2.3 registry and the plugin-side report both include it
 * even though the design's prose summary undercounts ("24"). See
 * `.superpowers/sdd/s9-plugin-report.md` §0 for the full discrepancy note.
 */
export const PIPELINE_PROMPT_KEYS = {
  detection: "detection.system",
  showrunner: "showrunner.system",
  sceneDirector: "scene_director.system",
  editor: "editor.system",
  sceneRefiner: "scene_refiner.system",
  scriptCritic: "script_critic.system",
  castCoverageCritic: "cast_coverage_critic.system",
  locationsCoverageCritic: "locations_coverage_critic.system",
  shotListCritic: "shot_list_critic.system",
  imageCritic: "image_critic.system",
  characterImageCritic: "character_image_critic.system",
  locationImageCritic: "location_image_critic.system",
  videoCritic: "video_critic.system",
  storyboardCohesionCritic: "storyboard_cohesion_critic.system",
  voiceMatcherBase: "voice_matcher.system_base",
  chatRefineShowrunnerBase: "chat_refine_showrunner.system_base",
  chatRefinePostmerge: "chat_refine_postmerge.system",
  helperAddBroll: "helper.add_broll.system",
  helperAnchorSceneStyle: "helper.anchor_scene_style.system",
  helperAuditPrompt: "helper.audit_prompt.system",
  helperBridgeToNextScene: "helper.bridge_to_next_scene.system",
  helperGenerateMotion: "helper.generate_motion.system",
  helperImprovePrompt: "helper.improve_prompt.system",
  helperOptimizeForModel: "helper.optimize_for_model.system",
  helperValidateMatchCut: "helper.validate_match_cut.system",
} as const
