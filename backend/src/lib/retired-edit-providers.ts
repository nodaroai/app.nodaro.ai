/**
 * Edit-image providers the platform no longer serves, with the sentence a run
 * of one gets — the ONE place both lanes read, so a direct `/v1/edit-image`
 * call and a server-run workflow node (an `upscale-image` / legacy
 * `edit-image` node the orchestrator builds a payload for) refuse it with the
 * same words, naming the replacement. Without this the orchestrator lane
 * reached the credit check with an id that has no price any more and failed
 * as "pricing is not configured", which reads as a platform fault.
 *
 * `grok-upscale` (retired 2026-10-29) never upscaled an image: the provider
 * endpoint it was wired to upscales a Grok VIDEO task, and the provider
 * offers no Grok image upscale, so every run was refused upstream.
 */
export const RETIRED_EDIT_PROVIDERS: Readonly<Record<string, string>> = {
  "grok-upscale":
    "grok-upscale was retired: it never upscaled an image (the provider's Grok upscale takes a Grok video task). " +
    "Use recraft-upscale or topaz-image-upscale instead.",
}

/**
 * The refusal for a retired edit provider, or undefined for a served one. An
 * OWN-key lookup: `provider` is request input, and a plain object answers an
 * inherited name (`constructor`, `toString`) with a function.
 */
export function retiredEditProviderReason(provider: unknown): string | undefined {
  return typeof provider === "string" && Object.hasOwn(RETIRED_EDIT_PROVIDERS, provider)
    ? RETIRED_EDIT_PROVIDERS[provider]
    : undefined
}
