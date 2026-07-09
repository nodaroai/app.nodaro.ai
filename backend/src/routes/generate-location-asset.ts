import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { resolveEntityImageCreditIdentifier } from "../lib/entity-credit-identifier.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { CHARACTER_ASPECT_OPTIONS, LOCATION_ASSET_TYPES, LOCATION_ATTACH_COLUMNS } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"

// Single source of truth for the asset-type and attach-column enums lives in
// `@nodaro/shared/entity-prompts` — reused by the MCP `generate_location` verb
// so the Zod enum here and the MCP tool's input enum can't drift.
const assetTypeEnum = z.enum(LOCATION_ASSET_TYPES)

const VARIANTS: Record<string, readonly string[]> = {
  timeOfDay: ["dawn", "morning", "noon", "afternoon", "golden hour", "dusk", "blue hour", "night", "midnight"],
  weather: ["clear", "cloudy", "light rain", "heavy rain", "storm", "snow", "blizzard", "fog", "mist"],
  seasons: ["spring", "summer", "autumn", "winter"],
  angles: ["wide", "medium", "closeup", "aerial", "low-angle", "eye-level", "bird's-eye", "dutch tilt"],
  lighting: ["soft natural", "harsh sunlight", "golden", "blue hour", "neon", "candlelit", "cinematic", "dramatic chiaroscuro"],
}

/**
 * Approved-source-image gate for the Location Studio path — parity with
 * `generate-character-asset` (portrait_required) and `generate-object-asset`
 * (main image). When `attachToLocationId` is set, every generated asset is an
 * image-to-image off the location's approved establishing shot
 * (`locations.source_image_url`); without that anchor the worker has nothing to
 * condition from, so a missing source would silently drop the location's
 * identity. Rejecting here costs nothing (no credits reserved, no DB writes).
 *
 * Exported for unit testing the gate independent of the HTTP layer.
 */
export function locationAssetGate(
  attachToLocationId: string | undefined,
  row: { source_image_url: string | null } | null,
): { ok: true } | { ok: false; code: "location_not_found" | "main_image_required" } {
  if (!attachToLocationId) return { ok: true } // not attaching → no anchor needed
  if (!row) return { ok: false, code: "location_not_found" }
  if (!row.source_image_url) return { ok: false, code: "main_image_required" }
  return { ok: true }
}

const generateLocationAssetBody = z.object({
  assetType: assetTypeEnum,
  variant: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  userPrompt: z.string().max(8000).optional(),
  category: z.string().max(50).optional(),
  // Free-text style — a location can carry any visual style (the project's
  // `visualStyle` vocabulary is broader: cinematic / noir / vintage / fantasy /
  // …), persisted as free text by the `POST /v1/locations` save route + the DB
  // column (both `z.string().max(50)`). Matching that contract here is load-
  // bearing: a narrow enum 400s every variant gen for a non-canonical style.
  // Style is only prompt seasoning (`${style} art style`), never a hard gate.
  style: z.string().max(50).optional(),
  sourceImageUrl: safeUrlSchema.optional(),
  provider: z.string().optional().default("nano-banana"),
  // Credit-affecting output levers (mirrors generate-image). The enums are
  // PERMISSIVE on purpose — a value the chosen model doesn't support is
  // ignored by the per-provider param routing / worker fail-safe, never 400d.
  resolution: z.enum(["1K", "2K", "4K", "0.5 MP", "1 MP", "2 MP", "4 MP"]).optional(),
  quality: z.enum(["medium", "high", "basic"]).optional(),
  // Optional framing override (the 4-value enum locations already use for
  // motion). The worker forwards it to the image model; absent = the model's
  // default. The studio's 360° surround path pins 16:9 so every ring view
  // matches the establishing shot's cinematic frame.
  aspectRatio: z.enum(CHARACTER_ASPECT_OPTIONS).optional(),
  userId: z.string().uuid().optional(),
  // Location Studio auto-attach: when all three are set, the worker appends
  // `{name: attachName, url: <result>}` to the named JSONB array column on the
  // user's location row after generation. `attachToColumn` is the DB column;
  // for canonical asset types it can be derived, but `custom` REQUIRES the
  // caller to set it explicitly (the worker can't infer the bucket).
  attachToLocationId: z.string().uuid().optional(),
  attachToColumn: z.enum(LOCATION_ATTACH_COLUMNS).optional(),
  attachName: z.string().min(1).max(200).optional(),
})

function buildVariantPrompt(
  assetType: string,
  variant: string,
  name: string,
  description?: string,
  category?: string,
  style?: string,
  userPrompt?: string,
): string {
  const categoryDesc = category ?? "location"
  const descPart = description ? `, ${description}` : ""
  const styleDesc = style ?? "realistic"

  const base = `${categoryDesc} scene, ${name}${descPart}. ${styleDesc} art style, 4k, highly detailed, cinematic lighting, no people, no text, no labels, no watermarks.`

  // Custom assets: prefer the long free-form `userPrompt` (typically the
  // multi-sentence text the studio UI collects in the description field) over
  // the short `variant` literal (which is usually just "custom" in the UI).
  // Mirrors the character-asset route's GAP-48 fix.
  if (assetType === "custom") {
    return `${userPrompt ?? variant}. ${base}`
  }

  if (assetType === "timeOfDay") {
    const timeMap: Record<string, string> = {
      dawn: "at dawn, soft pink and orange sunrise, early morning light",
      morning: "in the morning, bright natural daylight, fresh atmosphere",
      noon: "at noon, harsh overhead sun, strong shadows",
      afternoon: "in the afternoon, warm golden hour light",
      "golden hour": "at golden hour, low warm sun, long shadows, honey-toned light",
      dusk: "at dusk, purple and orange sunset, twilight",
      "blue hour": "at blue hour, deep blue twilight sky, ambient cool light",
      night: "at night, moonlight, stars visible, nighttime atmosphere",
      midnight: "at midnight, deep dark sky, moonlit highlights, quiet stillness",
    }
    const time = timeMap[variant] ?? `at ${variant}`
    return `${name}, ${time}. ${base}`
  }

  if (assetType === "weather") {
    const weatherMap: Record<string, string> = {
      clear: "on a clear day, blue sky, perfect weather",
      cloudy: "on a cloudy day, overcast sky, soft diffused light",
      "light rain": "during light rain, damp surfaces, gentle drizzle, soft mood",
      "heavy rain": "during heavy rain, slick wet surfaces, droplets streaking through air, moody atmosphere",
      storm: "during a storm, dramatic clouds, lightning, intense weather",
      snow: "covered in snow, winter scene, cold atmosphere, frost",
      blizzard: "in a blizzard, whiteout snow, near-zero visibility, violent wind",
      fog: "in thick fog, mysterious atmosphere, limited visibility",
      mist: "in soft mist, ethereal haze, diffused light",
    }
    const weather = weatherMap[variant] ?? `with ${variant} weather`
    return `${name}, ${weather}. ${base}`
  }

  if (assetType === "seasons") {
    const seasonMap: Record<string, string> = {
      spring: "in spring, fresh green growth, blossoms, mild light",
      summer: "in summer, lush warm palette, bright midday sun",
      autumn: "in autumn, amber and rust foliage, low warm light",
      winter: "in winter, snowy ground, bare trees, cold cyan-grey palette",
    }
    const season = seasonMap[variant] ?? `during ${variant}`
    return `${name}, ${season}. ${base}`
  }

  if (assetType === "lighting") {
    const lightingMap: Record<string, string> = {
      "soft natural": "soft natural lighting, diffused window light, gentle shadows",
      "harsh sunlight": "harsh direct sunlight, strong contrast, hard-edged shadows",
      golden: "golden lighting, warm honey-toned glow, long shadows",
      "blue hour": "blue-hour lighting, cool ambient twilight glow",
      neon: "neon lighting, saturated magenta and cyan signage glow, cyberpunk mood",
      candlelit: "candlelit lighting, warm flickering glow, deep shadows",
      cinematic: "cinematic lighting, motivated key, soft fill, controlled rim",
      "dramatic chiaroscuro": "dramatic chiaroscuro lighting, deep black shadows, sculpted highlights",
    }
    const lighting = lightingMap[variant] ?? `${variant} lighting`
    return `${name}, ${lighting}. ${base}`
  }

  // angles
  const angleMap: Record<string, string> = {
    wide: "wide establishing shot, showing full environment",
    medium: "medium shot, balanced perspective",
    closeup: "close-up detail shot, focusing on textures and elements",
    aerial: "aerial view, drone perspective, bird's eye view",
    "low-angle": "low angle shot, dramatic perspective looking up",
    "eye-level": "eye-level shot, natural human perspective",
    "bird's-eye": "bird's-eye view, straight-down overhead perspective",
    "dutch tilt": "dutch-tilt shot, canted horizon, unsettled mood",
  }
  const angle = angleMap[variant] ?? `${variant} shot`
  return `${name}, ${angle}. ${base}`
}

export async function generateLocationAssetRoutes(app: FastifyInstance) {
  // Quality/resolution-aware identifier via the shared resolver — the SAME
  // function the handler's DEBIT uses, so CHECK===DEBIT can't drift.
  app.post("/v1/generate-location-asset", { preHandler: creditGuard((req) => resolveEntityImageCreditIdentifier(req.body)) }, async (req, reply) => {
    const parsed = generateLocationAssetBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { assetType, variant, name, description, category, style, sourceImageUrl, userPrompt, attachToLocationId, attachToColumn, attachName } = parsed.data
    const userId = req.userId

    if (assetType !== "custom") {
      const validVariants = VARIANTS[assetType]
      if (validVariants && !validVariants.includes(variant)) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: `Invalid variant "${variant}" for asset type "${assetType}". Valid: ${validVariants.join(", ")}`,
          },
        })
      }
    }

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "userId is required" },
      })
    }

    // Approved-source-image gate (Location Studio path). Mirrors the
    // character/object routes: when attaching to a location, require an
    // approved establishing shot to i2i from. Runs BEFORE credit reservation
    // and the DB insert so a missing anchor costs nothing. The SAME row read
    // also supplies the identity anchors the prompt/worker need: the main
    // image (i2i source), the row's real name, and the canonical description
    // — previously the gate read the row and then DISCARDED it, so location
    // assets generated unanchored ("Untitled location at golden hour" with no
    // reference image → an unrelated landscape).
    let sourceImageUrlAnchor: string | null = null
    let anchorName: string | null = null
    let anchorDescription: string | null = null
    if (attachToLocationId) {
      const { data: locRow } = await supabase
        .from("locations")
        .select("source_image_url, name, canonical_description")
        .eq("id", attachToLocationId)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .single()
      const gate = locationAssetGate(attachToLocationId, locRow ?? null)
      if (!gate.ok) {
        return gate.code === "location_not_found"
          ? reply.status(404).send({
              error: { code: "not_found", message: "Location not found" },
            })
          : reply.status(400).send({
              error: { code: "main_image_required", message: "Generate a main image first" },
            })
      }
      sourceImageUrlAnchor = (locRow?.source_image_url as string | null) ?? null
      anchorName = (locRow?.name as string | null) ?? null
      anchorDescription = (locRow?.canonical_description as string | null) ?? null
    }

    // Composite identifier (provider[:quality|:resolution|…]) — derived by
    // the SAME resolver the preHandler ran on the raw body, so CHECK===DEBIT.
    const modelIdentifier = resolveEntityImageCreditIdentifier(parsed.data)

    // Use the location's anchor image as the i2i source when the studio path
    // runs, UNLESS the caller passed an explicit sourceImageUrl (their choice
    // wins). Outside the studio path, behavior is unchanged.
    const resolvedSourceImageUrl = sourceImageUrl ?? sourceImageUrlAnchor ?? undefined
    // The ROW is the identity truth when attaching: its real name beats the
    // caller's placeholder, and the canonical description (when the caller
    // sent none) keeps the variant on-model even before the image lands.
    const promptName = anchorName ?? name
    const promptDescription = description ?? anchorDescription ?? undefined

    const prompt = buildVariantPrompt(assetType, variant, promptName, promptDescription, category, style, userPrompt)

    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: { ...buildJobInputData(parsed.data, "generate-location-asset"), prompt },
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })
      .select("id")
      .single()

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("generate-location-asset", {
      jobId: job.id,
      prompt,
      sourceImageUrl: resolvedSourceImageUrl,
      assetType,
      variant,
      provider: parsed.data.provider,
      aspectRatio: parsed.data.aspectRatio,
      resolution: parsed.data.resolution,
      quality: parsed.data.quality,
      usageLogId,
      attachToLocationId,
      attachToColumn,
      attachName,
    })

    return { jobId: job.id }
  })
}
