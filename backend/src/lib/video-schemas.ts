/**
 * Shared Zod schemas for video route validation.
 *
 * Used by generate-video.ts (image-to-video) and text-to-video.ts.
 */

import { z } from "zod"
import { safeUrlSchema } from "./url-validator.js"

/** A single Kling 3.0 element (image or video reference). */
const klingElementSchema = z.object({
  name: z.string().max(50),
  description: z.string().min(1).max(200),
  type: z.enum(["image", "video"]),
  urls: z.array(safeUrlSchema).min(1).max(4),
}).refine(
  (el) => el.type === "video" ? el.urls.length === 1 : el.urls.length >= 2,
  { message: "Image elements require 2-4 URLs, video elements require exactly 1 URL" }
)

/** Kling 3.0 multi-shot prompt definitions. */
export const shotsSchema = z.array(
  z.object({
    prompt: z.string().max(500),
    duration: z.number().int().min(1).max(12),
  })
).max(6)

/** Kling 3.0 element references (up to 5). */
export const elementsSchema = z.array(klingElementSchema).max(5)
