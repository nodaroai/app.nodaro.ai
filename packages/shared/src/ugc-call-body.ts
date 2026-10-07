/**
 * A UGC builder call `{ tool, args }` (MCP argument names) → the REST body of
 * the public route that tool dispatches to. The builder sets every price lever;
 * this adds none — its one addition is the image of a call that needs the
 * previous step's image (`imageArg`, or the photo of `image_to_text`). A tool
 * it does not know → undefined, so an app older than the builder fails plainly
 * instead of guessing. Kept equal to the MCP verbs by ugc-call-body-parity.test.ts.
 */
export interface UgcToolCall {
  readonly tool: string
  readonly args: Readonly<Record<string, unknown>>
  readonly imageArg?: string
}
export type UgcRouteBody = {
  readonly path: "/v1/generate-image" | "/v1/image-to-image" | "/v1/image-to-text/describe"
  readonly body: Record<string, unknown>
}

const pick = (a: Readonly<Record<string, unknown>>, from: string, to: string): Record<string, unknown> =>
  a[from] !== undefined && a[from] !== null ? { [to]: a[from] } : {}

/** The LLM levers image_to_text forwards (the verb's llmPayloadFields). */
function llmFields(a: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return {
    ...pick(a, "llmModel", "llmModel"),
    ...pick(a, "reasoning_effort", "reasoningEffort"),
    ...(a.advanced_mode === true ? { advancedMode: true } : {}),
    ...pick(a, "temperature", "temperature"),
    ...pick(a, "max_tokens", "maxTokens"),
  }
}

export function ugcCallToRouteBody(
  call: UgcToolCall,
  opts: { readonly image?: string } = {},
): UgcRouteBody | { readonly error: string } | undefined {
  const args: Record<string, unknown> = { ...call.args }
  if (call.imageArg) {
    if (!opts.image) return { error: `${call.tool} needs the previous step's image` }
    args[call.imageArg] = opts.image
  }
  switch (call.tool) {
    case "generate_image":
      return {
        path: "/v1/generate-image",
        body: {
          ...pick(args, "prompt", "prompt"),
          ...pick(args, "model", "provider"),
          ...pick(args, "aspect_ratio", "aspectRatio"),
          ...pick(args, "resolution", "resolution"),
          ...pick(args, "quality", "quality"),
          ...pick(args, "negative_prompt", "negativePrompt"),
        },
      }
    case "image_to_image":
      return {
        path: "/v1/image-to-image",
        body: {
          ...pick(args, "image_url", "imageUrl"),
          ...pick(args, "prompt", "prompt"),
          ...pick(args, "model", "provider"),
          ...pick(args, "resolution", "resolution"),
          ...pick(args, "quality", "quality"),
          ...pick(args, "strength", "strength"),
          ...pick(args, "aspect_ratio", "aspectRatio"),
          ...pick(args, "negative_prompt", "negativePrompt"),
          ...pick(args, "seed", "seed"),
        },
      }
    case "image_to_text": {
      const image = opts.image ?? (typeof args.image_url === "string" ? args.image_url : undefined)
      if (!image) return { error: "image_to_text needs an image" }
      return {
        path: "/v1/image-to-text/describe",
        body: {
          imageUrl: image,
          ...pick(args, "detail_level", "detailLevel"),
          ...pick(args, "custom_prompt", "customPrompt"),
          ...llmFields(args),
        },
      }
    }
    default:
      return undefined
  }
}
