/** Request shapes of the view-link routes (routes/workflow-view-links.ts, routes/workflow-views.ts). */
import { z } from "zod"
import { shareLocaleField } from "../share-links/card-locale.js"

export const viewWorkflowParams = z.object({ id: z.string().uuid() })

/** A view token as the public routes take it; a token of another shape is answered as unknown. */
export const viewTokenParams = z.object({ token: z.string().min(1).max(64) })

export const enableViewLinkBody = z
  .object({
    locale: shareLocaleField,
  })
  .strict()
  .optional()

export const updateViewLinkBody = z
  .object({
    indexable: z.boolean().describe("Whether search engines may index the view. On by default."),
  })
  .strict()

export const saveViewExportBody = z
  .object({
    includeAssets: z
      .boolean()
      .describe("Whether the copy carries the characters, locations, objects and creatures the workflow uses (and keeps the canvas's results). Without them it is a clean template."),
  })
  .strict()
