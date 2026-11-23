/**
 * The shape of a cover a caller names, declared once for every surface that
 * takes one: `PATCH /v1/jobs/:id { cover }` (routes/job-title.ts) and the MCP
 * `update_job` tool (lib/mcp/tools/job-update-tool.ts). The bound here only
 * shapes the request; whose file it is and whether it is a real picture is
 * lib/job-cover/cover-source.ts's question.
 */
import { z } from "zod"

/** The longest cover address accepted (the column's CHECK, migration 686, holds the same bound). */
export const JOB_COVER_URL_MAX_CHARS = 2048

/** A cover address: a web address (a self-hosted install's own storage may be http), bounded. */
export const jobCoverUrlSchema = z
  .string()
  .url()
  .max(JOB_COVER_URL_MAX_CHARS)
  .refine((u) => /^https?:\/\//i.test(u), "must be a web address")

/** A library asset of the caller's, or the address of one of their images on our storage. */
export const jobCoverRequestSchema = z.union([
  z.object({ assetId: z.string().uuid() }).strict(),
  z.object({ url: jobCoverUrlSchema }).strict(),
])

/** What a caller sends: a library asset of theirs, or the address of one of their images on our CDN. */
export type JobCoverRequest = { readonly assetId: string } | { readonly url: string }
