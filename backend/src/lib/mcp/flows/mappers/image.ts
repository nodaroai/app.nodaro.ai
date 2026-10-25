import { resolveMaskCompositeSettings } from "@nodaro/shared/media"
import { OVERLAY_HANDLE_IDS } from "../../../../providers/image/overlay-contract.js"
import { defined, inputsOf, num, str, urls, type Body, type FlowNodeSpec, type RouteMappers } from "./kit.js"

/** Is any of these body fields set? */
const anySet = (body: Body, keys: readonly string[]) => keys.some((k) => body[k] !== undefined && body[k] !== null)

/** The edit-image providers a node re-runs; the task-chained grok ops take a task id no node holds. */
const UPSCALE_PROVIDERS: ReadonlySet<string> = new Set(["recraft-upscale", "topaz-image-upscale"])
const REMOVE_BG_PROVIDER = "recraft-remove-bg"
const PROMPT_EDIT_PROVIDER = "nano-banana-edit"

/**
 * /v1/edit-image is three canvas nodes, picked by provider as the engine's
 * legacy `edit-image` migration picks them. Each carries only its own levers:
 * an upscale with a prompt, or a prompt edit with an upscale factor, is no node.
 */
function editImageNode(body: Body): FlowNodeSpec | null {
  const imageUrl = str(body.imageUrl)
  const provider = str(body.provider) ?? "recraft-upscale"
  if (!imageUrl) return null
  const inputs = inputsOf("image", "image", [imageUrl])
  if (UPSCALE_PROVIDERS.has(provider)) {
    if (anySet(body, ["prompt", "negativePrompt", "style", "seed"])) return null
    return {
      type: "upscale-image",
      outputKey: "generatedImageUrl",
      inputs,
      data: defined({
        label: "Upscale Image",
        provider,
        upscaleFactor: str(body.upscaleFactor),
        targetResolution: str(body.targetResolution),
        fieldMappings: {},
      }),
    }
  }
  if (provider === REMOVE_BG_PROVIDER) {
    if (anySet(body, ["prompt", "negativePrompt", "style", "seed", "upscaleFactor", "targetResolution"])) return null
    return { type: "remove-background", outputKey: "generatedImageUrl", inputs, data: { label: "Remove Background", fieldMappings: {} } }
  }
  if (provider === PROMPT_EDIT_PROVIDER) {
    const prompt = str(body.prompt)
    if (!prompt || anySet(body, ["upscaleFactor", "targetResolution"])) return null
    return {
      type: "modify-image",
      outputKey: "generatedImageUrl",
      prompt,
      inputs,
      data: defined({
        label: "Modify Image",
        prompt,
        provider,
        negativePrompt: str(body.negativePrompt),
        style: str(body.style),
        seed: num(body.seed),
        fieldMappings: {},
      }),
    }
  }
  return null
}

/** The route's per-layer defaults, which the engine's path (no route Zod) does not apply. */
const OVERLAY_LAYER_DEFAULTS = { anchor: "center", x: 0, y: 0, width: 25, opacity: 1, rotation: 0, blend: "over", fit: "contain" } as const

const kindOf = (layer: Record<string, unknown>) => str(layer.kind) ?? "image"

/**
 * Image Overlay: the base on `image`, each image layer's picture on its own
 * layer handle (`overlay`, `overlay2`, …, index-aligned with `data.layers`),
 * and the layer settings in the node. Text / QR / shape layers need no wire.
 */
function imageOverlayNode(body: Body): FlowNodeSpec | null {
  const imageUrl = str(body.imageUrl)
  const raw = Array.isArray(body.layers) ? (body.layers as unknown[]) : []
  if (!imageUrl || raw.length === 0 || raw.length > OVERLAY_HANDLE_IDS.length) return null
  if (raw.some((l) => !l || typeof l !== "object" || Array.isArray(l))) return null
  const layers = raw as ReadonlyArray<Record<string, unknown>>
  const layerInputs = layers.flatMap((layer, i) => {
    const url = kindOf(layer) === "image" ? str(layer.imageUrl) : undefined
    return url ? inputsOf("image", OVERLAY_HANDLE_IDS[i], [url]) : []
  })
  // Every image layer needs its picture; the route refuses one without it.
  if (layerInputs.length !== layers.filter((l) => kindOf(l) === "image").length) return null
  const canvas = body.canvas && typeof body.canvas === "object" ? (body.canvas as Record<string, unknown>) : undefined
  return {
    type: "image-overlay",
    outputKey: "generatedImageUrl",
    inputs: [...inputsOf("image", "image", [imageUrl]), ...layerInputs],
    data: defined({
      label: "Image Overlay",
      layers: layers.map(({ imageUrl: _url, ...layer }) => ({ ...OVERLAY_LAYER_DEFAULTS, ...layer, kind: kindOf(layer) })),
      layerCount: layers.length,
      canvas: canvas ? { backgroundColor: "#000000", ...canvas } : undefined,
      baseFit: str(body.baseFit) ?? "contain",
      outputFormat: str(body.outputFormat) ?? "png",
      variants: urls(body.variants).length > 0 ? urls(body.variants) : undefined,
      maskMode: str(body.maskMode) ?? "around",
      maskSpread: num(body.maskSpread) ?? 48,
      fieldMappings: {},
    }),
  }
}

/** Image routes whose calls become nodes. */
export const IMAGE_ROUTE_MAPPERS: RouteMappers = {
  "/v1/generate-image": {
    tools: ["generate_image"],
    fields: new Set([
      "prompt", "provider", "aspectRatio", "resolution", "quality", "negativePrompt",
      "referenceImageUrls", "strength", "guidanceScale", "baseImageUrl", "maskUrl",
    ]),
    map(body) {
      const prompt = str(body.prompt)
      const provider = str(body.provider)
      if (!prompt || !provider) return null
      return {
        type: "generate-image",
        outputKey: "generatedImageUrl",
        prompt,
        inputs: inputsOf("image", "references", urls(body.referenceImageUrls)),
        data: defined({
          label: "Generate Image",
          prompt,
          provider,
          model: provider,
          style: "",
          aspectRatio: str(body.aspectRatio) ?? "1:1",
          negativePrompt: str(body.negativePrompt) ?? "",
          resolution: str(body.resolution),
          quality: str(body.quality),
          strength: num(body.strength),
          guidanceScale: num(body.guidanceScale),
          baseImageUrl: str(body.baseImageUrl),
          maskUrl: str(body.maskUrl),
          fieldMappings: {},
        }),
      }
    },
  },

  "/v1/image-to-image": {
    tools: ["modify_image", "image_to_image"],
    fields: new Set([
      "imageUrl", "prompt", "provider", "aspectRatio", "resolution", "quality", "negativePrompt",
      "referenceImageUrls", "strength", "seed", "maskUrl",
    ]),
    map(body) {
      const imageUrl = str(body.imageUrl)
      const provider = str(body.provider)
      if (!imageUrl || !provider) return null
      const prompt = str(body.prompt) ?? ""
      // The node's first wired image is the one it edits; the others are references.
      return {
        type: "modify-image",
        outputKey: "generatedImageUrl",
        prompt,
        inputs: inputsOf("image", "image", [imageUrl, ...urls(body.referenceImageUrls)]),
        data: defined({
          label: "Modify Image",
          prompt,
          provider,
          aspectRatio: str(body.aspectRatio),
          resolution: str(body.resolution),
          quality: str(body.quality),
          negativePrompt: str(body.negativePrompt),
          strength: num(body.strength),
          seed: num(body.seed),
          maskUrl: str(body.maskUrl),
          fieldMappings: {},
        }),
      }
    },
  },

  // A mask, a task id or segment indexes are levers none of the three nodes holds.
  "/v1/edit-image": {
    tools: ["edit_image"],
    fields: new Set(["imageUrl", "provider", "prompt", "negativePrompt", "style", "seed", "upscaleFactor", "targetResolution"]),
    map: editImageNode,
  },

  // Per-image size hints and captions are not carried: the node keys them by
  // its source nodes' ids, which a mapper cannot know.
  "/v1/image-collage": {
    tools: ["image_collage"],
    fields: new Set(["imageUrls", "numbered", "badgePosition", "layout", "resolution", "aspectRatio", "gap", "backgroundColor"]),
    map(body) {
      const imageUrls = urls(body.imageUrls)
      // One wire per image, in order: a repeated image would fold into one wire.
      if (imageUrls.length < 2 || new Set(imageUrls).size !== imageUrls.length) return null
      return {
        type: "image-collage",
        outputKey: "generatedImageUrl",
        inputs: inputsOf("image", "in", imageUrls),
        // The route's defaults, written down: the engine's own (2K, 1:1) differ.
        data: defined({
          label: "Image Collage",
          layout: str(body.layout) ?? "smart",
          resolution: str(body.resolution) ?? "4K",
          aspectRatio: str(body.aspectRatio) ?? "4:3",
          gap: num(body.gap) ?? 24,
          backgroundColor: str(body.backgroundColor) ?? "#ffffff",
          numbered: body.numbered === true ? true : undefined,
          badgePosition: str(body.badgePosition),
          fieldMappings: {},
        }),
      }
    },
  },

  // The QR link handle takes text, which no input here carries: a qrText call is no node.
  "/v1/image-overlay": {
    tools: ["image_overlay"],
    fields: new Set(["imageUrl", "layers", "canvas", "baseFit", "outputFormat", "variants", "maskMode", "maskSpread"]),
    map: imageOverlayNode,
  },

  "/v1/extract-frame": {
    tools: ["extract_frame"],
    fields: new Set(["videoUrl", "mode", "timestamp"]),
    map(body) {
      const videoUrl = str(body.videoUrl)
      if (!videoUrl) return null
      return {
        type: "extract-frame",
        outputKey: "generatedImageUrl",
        inputs: inputsOf("video", "in", [videoUrl]),
        data: defined({ label: "Extract Frame", mode: str(body.mode) ?? "first", timestamp: num(body.timestamp) ?? 0, fieldMappings: {} }),
      }
    },
  },

  // A video result, kept here beside the masks it composites. Pixelate / blur
  // fills take no foreground: only a sent one is wired.
  "/v1/mask-composite": {
    tools: ["mask_composite"],
    fields: new Set([
      "foregroundUrl", "backgroundUrl", "maskUrl", "invertMask", "feather", "grow", "opacity",
      "fill", "pixelSizePct", "blurStrengthPct", "backgroundFit", "audioSource",
    ]),
    map(body) {
      const foreground = str(body.foregroundUrl)
      const background = str(body.backgroundUrl)
      const mask = str(body.maskUrl)
      if (!background || !mask) return null
      return {
        type: "mask-composite",
        outputKey: "generatedVideoUrl",
        inputs: [
          ...(foreground ? inputsOf("video", "video", [foreground]) : []),
          ...inputsOf("video", "background-video", [background]),
          ...inputsOf("video", "mask-video", [mask]),
        ],
        // The settings the route resolves the body to, its defaults included.
        data: { label: "Mask Composite", ...resolveMaskCompositeSettings(body), fieldMappings: {} },
      }
    },
  },
}
