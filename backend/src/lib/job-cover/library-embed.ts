/**
 * The library listing's embed of each file's job (`job:jobs!job_id(...)`):
 * the name its owner gave it (`title`, migration 609) and the job's picture
 * (`coverUrl`, decided 2026-11-23) — the owner's cover (`cover_url`,
 * migration 686), else the provider's art, read as one JSON field
 * (`output_data->>sunoImageUrl`), never the whole output. Each column joins
 * only once this database has it (lib/jobs-optional-column.ts), and the
 * embed itself only once one of them does — so a database before both
 * migrations reads the listing exactly as before (no title, no picture).
 */
import { titleColumnPresent } from "../jobs-title-column.js"
import { coverColumnPresent } from "../jobs-cover-column.js"
import { effectiveJobCover } from "./effective-cover.js"

export function libraryJobEmbedSelect(): string {
  const fields = [
    ...(titleColumnPresent() ? ["title"] : []),
    ...(coverColumnPresent() ? ["cover_url"] : []),
  ]
  if (fields.length === 0) return ""
  return `, job:jobs!job_id(${[...fields, "sunoImageUrl:output_data->>sunoImageUrl"].join(", ")})`
}

/** The picture of an embedded job, whichever shape the embed arrived in; null when there is none. */
export function embeddedJobCover(embed: unknown): string | null {
  const job = (Array.isArray(embed) ? embed[0] : embed) as { cover_url?: unknown; sunoImageUrl?: unknown } | null | undefined
  if (!job) return null
  return effectiveJobCover({ cover_url: job.cover_url, output_data: { sunoImageUrl: job.sunoImageUrl } })
}
