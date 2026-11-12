/**
 * `split_into_layers` — one image split into a base picture and separate
 * layers, each element on its own transparent PNG: the MCP face of
 * POST /v1/split-into-layers (the Split into Layers node). Registered beside
 * `generate_mask` by `registerImageVerbs`. Unlisted while the deployment does
 * not offer the node to its users (Admin → Availability, or a surface profile).
 * The node's type is read from the unit that declares this tool
 * (`mcp.widgetModelFor`), so the verb names no type id; its levers are the
 * route's own (`@nodaro/render-rules` layer-split).
 */
import { z } from "zod"
import { LAYER_SPLIT_DEFAULT_SIZE, LAYER_SPLIT_MAX_LAYERS, LAYER_SPLIT_PROMPT_MAX, LAYER_SPLIT_SIZES } from "@nodaro/render-rules"
import { resolveAssetId } from "../asset-resolver.js"
import { isNodeDenied, USER_VIEWER } from "../../surface-deny.js"
import { widgetModelOf } from "../widget-models.js"
import { WIDGET_URI } from "../widgets/registrar.js"
import type { RegisterOpts } from "./verbs-image.js"
import { dispatchJob, JOB_OUTPUT_SCHEMA, uiMeta } from "./_verb-helpers.js"
import { creditHint } from "./_credit-hint.js"

export const SPLIT_INTO_LAYERS_TOOL = "split_into_layers"

function refuse(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function splitIntoLayersDescription(nodeType: string): string {
  const layers = LAYER_SPLIT_MAX_LAYERS
  return (
    "Split one image into a base picture and separate layers — each element on its own transparent PNG, with its name, description, stacking order and position. " +
    `Pass \`image_url\` or \`image_asset_id\`. \`max_layers\` (${layers.min}–${layers.max}, default ${layers.default}) caps the layers: more elements merge into fewer layers, none is dropped. ` +
    `\`size\` is each image's pixel budget (\`${LAYER_SPLIT_DEFAULT_SIZE}\` default, about one megapixel; \`auto\` keeps the picture's own size, 1K–2K). ` +
    "`prompt` names what to separate (`<bbox>x1 y1 x2 y2</bbox>` marks, 0–1000, allowed); empty, the main elements are found automatically. " +
    "Returns a job_id; read `get_job` / `wait_for_job` `outputData`: `{ imageUrl, layers, layerCount, layersNotSaved, layerData: [{ name?, description?, zIndex, width?, height?, box?, boxNormalized?, url, baseUrl }] }` — " +
    "`imageUrl` the base (opaque PNG), `layers` each layer's PNG bottom to top, `layerData` in the same order (`baseUrl`: the base it was cut from). `zIndex` 1 sits on the base, higher is drawn above; " +
    "`box` `{ x1, y1, x2, y2 }` is where the layer sits on the base, in the BASE's pixels (`boxNormalized`: the same on a 0–1000 scale); " +
    "`width`/`height` are the layer file's own pixels — a layer is cropped to its element, so scale it to its `box` to put it back. No element found: the base only. " +
    `Price (default run, ${layers.default} layers at ${LAYER_SPLIT_DEFAULT_SIZE}): ${creditHint(nodeType)}. ` +
    "A run holds the price of max_layers + 1 images at its size (2K and auto above 1K and 1.5K) and is charged only for the images it returns."
  )
}

export function registerSplitIntoLayersVerb({ server, session, fastify }: RegisterOpts): void {
  const nodeType = widgetModelOf(SPLIT_INTO_LAYERS_TOOL)
  if (isNodeDenied(nodeType, USER_VIEWER)) return
  server.registerTool(
    SPLIT_INTO_LAYERS_TOOL,
    {
      title: "Split into Layers",
      description: splitIntoLayersDescription(nodeType),
      inputSchema: {
        image_url: z.string().url().optional().describe("Image to split."),
        image_asset_id: z.string().optional().describe("Image to split, as a Nodaro image job id or an uploaded image's id."),
        max_layers: z.number().int().min(LAYER_SPLIT_MAX_LAYERS.min).max(LAYER_SPLIT_MAX_LAYERS.max).optional().describe(`The most layers to make. Default ${LAYER_SPLIT_MAX_LAYERS.default}.`),
        size: z.enum(LAYER_SPLIT_SIZES).optional().describe(`Each image's pixel budget. Default ${LAYER_SPLIT_DEFAULT_SIZE}.`),
        prompt: z.string().max(LAYER_SPLIT_PROMPT_MAX).optional().describe("What to separate."),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: uiMeta(WIDGET_URI.jobImage),
    },
    async (args) => {
      let imageUrl = args.image_url
      if (!imageUrl && args.image_asset_id) {
        try {
          imageUrl = (await resolveAssetId({ assetId: args.image_asset_id, userId: session.userId, expectedKind: "image" })) ?? undefined
        } catch (err) {
          return refuse(`image_asset_id: ${messageOf(err)}`)
        }
        if (!imageUrl) return refuse(`image_asset_id: no image found for ${args.image_asset_id}.`)
      }
      if (!imageUrl) return refuse("Pass image_url or image_asset_id.")
      const prompt = args.prompt?.trim()
      const payload: Record<string, unknown> = {
        imageUrl,
        ...(args.max_layers !== undefined ? { maxLayers: args.max_layers } : {}),
        ...(args.size ? { size: args.size } : {}),
        ...(prompt ? { prompt } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, {
        // The route's literal path (not `/v1/${nodeType}`), so the surface checker reads the route this tool calls.
        url: "/v1/split-into-layers",
        payload,
        label: "split into layers",
        widgetKind: "image",
        widgetData: { prompt: prompt ?? "(split into layers)", model: nodeType },
      })
    },
  )
}
