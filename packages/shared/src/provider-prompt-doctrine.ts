/**
 * Per-provider prompting doctrine — the single source of truth for "how to
 * prompt model family X well". Consumed by:
 *   1. backend/src/prompts/prompt-wizard-system.ts  (enhance/generate system prompts)
 *   2. backend/scripts/gen-skills (provider-prompting block in video node skills)
 *   3. backend/src/lib/mcp/tools/models.ts          (list_models promptTips)
 *   4. compact recipes in MCP tool descriptions point here via get_node_skill
 *
 * Sources, in precedence order (conflicts resolve top-down):
 *   - Official BytePlus ModelArk "Dreamina Seedance 2.0 series prompt guide"
 *     https://docs.byteplus.com/en/docs/ModelArk/2222480
 *   - Official launch post https://seed.bytedance.com/en/blog/official-launch-of-seedance-2-0
 *   - KIE API docs https://docs.kie.ai/market/bytedance/seedance-2
 */
export interface ProviderPromptDoctrine {
  /** MODEL_CATALOG ids this doctrine covers. */
  readonly providers: readonly string[]
  /** Human heading for skill docs, e.g. "Seedance 2.0 (seedance-2, seedance-2-fast)". */
  readonly heading: string
  /** Short bullets for compact surfaces (list_models promptTips). ≤220 chars each. */
  readonly tips: readonly string[]
  /** Full markdown doctrine for system prompts and generated skill docs. */
  readonly doctrine: string
}

const SEEDANCE_2_DOCTRINE: ProviderPromptDoctrine = {
  providers: ["seedance-2", "seedance-2-fast"],
  heading: "Seedance 2.0 (seedance-2, seedance-2-fast)",
  tips: [
    "Storyboard complex videos as 'Shot 1: … Shot 2: …' WITHOUT timestamps — timed shots like '(0-3s)' are officially unstable and can break generation.",
    "One camera movement per shot; describe actions per body part with degree ('slowly raises a hand'); express emotion as physical detail, never abstract words.",
    "Native multi-track audio — cue it inline: （background music）, <sound effects>, and quoted dialogue.",
    "References go by ordinal (@Image 1, Video 2) in attachment order; earlier = higher priority. Identity = ONE headshot + ONE full-body (multi-view sheets cause ID drift). 4-5 assets total beats maxing the 9/3/3 caps.",
    "No negative-prompt parameter — put constraints in the prompt: 'keep it subtitle-free, do not generate a watermark, do not generate a logo'.",
  ],
  doctrine: `Prompt structure (front-load what matters most):
precise subject → action details → scene/environment → lighting & color tone → camera movement → visual style → image quality → constraints.

**Shots & pacing**
- Storyboard complex videos as "Shot 1: … Shot 2: … Shot 3: …" in event order. Do NOT attach timestamps (e.g. "(0-3s)") — precise-timing support is officially unstable and forcing durations can break generation; let the model pace naturally.
- Per shot cover, in order: camera move or transition, subject action + expression, spatial/position change, audio for that shot.
- One camera movement type per shot — never ask for push + pan + orbit at once (image instability).
- Prefer slow, gentle, continuous movements over high-burst action (sprints, big jumps, violent rolls morph). Describe actions per body part with quantified degree: "slowly raises a hand", "pushes hard off the ground". Chain actions with inertia: "uses the momentum of the turn to naturally raise an arm".
- Express emotion as externalized physical detail, never abstract words: not "very sad" but "lowering the head, shoulders trembling slightly, eyes reddening, fingers clutching the corner of clothing".

**References (when reference media is attached)**
- Refer to assets by ordinal in attachment order: "@Image 1", "Video 2", "Audio 1". Asset ORDER is priority — put the most identity-critical asset first.
- Define each subject once, then reuse the label consistently: 'Define the woman in the red dress in Image 1 as the courier' … 'the courier opens the door'. In multi-character scenes bind every character to its image ("the man from Image 1 hands the box to the woman from Image 2") and append: "do not generate duplicate copies of the same character".
- Character identity: ONE close-up headshot + ONE full-body image is ideal. Do NOT attach multi-view/three-view character sheets — the model reads the views as separate people, causing identity drift and twin duplicates.
- 4-5 assets total works best (1-2 character images + 1 scene image + 1 camera-movement video + 1 audio clip). Maxing out the 9-image/3-video/3-audio limits degrades feature priority and adherence.
- Editing/extension instructions name clips directly: "Extend Video 1 backward…", "Remove the chair from Video 1". Saying "reference Video 1" flips the model into reference mode and breaks the edit. Track completion: "Video 1 + [transition description] + followed by Video 2" (≤3 clips, ≤15s total).

**Audio (native multi-track: music + ambience + voice, stereo)**
- Cue the layers separately with the official symbols: full-width parentheses for music （slow jazz piano in the background）, angle brackets for sound effects <rain tapping on glass>, and dialogue as quoted speech: the man says "It's not that bad". Seedance also accepts curly-brace dialogue, but on Nodaro curly braces are reserved for prompt variables — always use quotes for dialogue here.
- Mark the language for non-English/Chinese dialogue ("says in Japanese …").
- With a reference voice attached, also describe the timbre in words: "the low, warm, finely grainy middle-aged male voice of Audio 1".

**Quality & constraints**
- Quality tail: "HD, rich details, cinematic texture, natural colors, stable picture."
- Anti-junk constraints (these official templates ARE negative-form): "keep it subtitle-free", "avoid generating any text or subtitles", "do not generate a watermark", "do not generate a logo". Landscape output is markedly less subtitle-prone than portrait — generate 16:9 and crop when portrait text-safety matters.
- There is NO negative-prompt parameter on Seedance — all constraints belong in the prompt text itself.

**Known weaknesses → workarounds**
- Text rendering is weak: keep on-screen text to short common words; for exact text or logos, attach the artwork as a reference image and instruct "the logo from Image N stays in the corner unchanged".
- More than 4 referenced people gets unstable: group people into composite images of ≤4 first (image generation), then reference those composites.
- Repeated extension degrades quality: prefer high-definition reference assets and avoid stacking many continuations.`,
}

export const PROVIDER_PROMPT_DOCTRINES: readonly ProviderPromptDoctrine[] = [
  SEEDANCE_2_DOCTRINE,
]

const DOCTRINE_BY_PROVIDER: ReadonlyMap<string, ProviderPromptDoctrine> = new Map(
  PROVIDER_PROMPT_DOCTRINES.flatMap((d) => d.providers.map((p) => [p, d] as const)),
)

/** Full doctrine for a provider id, or undefined when none exists. */
export function getPromptDoctrine(providerId: string): ProviderPromptDoctrine | undefined {
  return DOCTRINE_BY_PROVIDER.get(providerId)
}

/** Compact tips for a provider id ([] when none) — used by list_models. */
export function getPromptTips(providerId: string): readonly string[] {
  return DOCTRINE_BY_PROVIDER.get(providerId)?.tips ?? []
}
