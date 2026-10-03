/**
 * The body of POST /v1/templates/publish: what a creator fills in on the
 * "Publish as template" form. It lives apart from the route so a first-party
 * template's gallery copy (lib/tutorial-seed/templates/*.json, the text a
 * maintainer pastes into that form) is checked against the very limits the
 * form enforces, without loading the route's database and billing modules.
 */
import { z } from "zod"
import { TEMPLATE_CATEGORIES } from "@nodaro/shared"

export const VALID_OUTPUT_TYPES = ["image", "video", "audio", "text"] as const

export const publishBodySchema = z.object({
  workflowId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  markdownDescription: z.string().max(5000).optional(),
  slug: z.string().min(1).max(50).optional(),
  category: z.enum(TEMPLATE_CATEGORIES).optional(),
  outputTypes: z.array(z.enum(VALID_OUTPUT_TYPES)).max(4).optional(),
  tags: z.array(z.string().max(30)).max(10).optional(),
  previewMediaUrl: z.string().url().optional(),
  previewMediaType: z.enum(["image", "video"]).optional(),
  // Creator-facing back-compat boolean — toggles only the 'marketplace' tag.
  // The 'tutorial' tag is admin-only and managed via the tutorial-flag endpoint.
  isListed: z.boolean().optional(),
})
