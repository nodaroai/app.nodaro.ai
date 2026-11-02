import { z } from "zod"
import type { GitHubReader } from "./github.js"
import { HEADER_REPO } from "./products.js"
import type { HeaderMapResult } from "./report-types.js"
import { failure } from "./site-readings.js"
import { checkWorlds, type ProbeLink } from "./world-links.js"

/**
 * The header's explanations of itself — what is in it, how a change reaches
 * the sites, how it shares a phone screen — kept in its own repository beside
 * the code they describe, and read from its default branch as it stands, so an
 * edit there shows here without a release. Never written in this code: it is
 * published, and the explanations name private products and decisions. The
 * file also lists the header's worlds; each one's address is asked
 * (`world-links.ts`).
 *
 * The page draws the figures (the bar, the phone, the release lanes…); the
 * file gives only their words, as plain text, in a fixed shape per figure and
 * within limits. Anything else is refused whole, with the reason, rather than
 * drawn in part. The header's repository holds the same shape in its own test.
 */

export const MAP_FILE = "docs/header-map.json"
/** A larger file is refused before it is parsed. */
const MAX_BYTES = 64_000

const text = (max: number) => z.string().trim().min(1).max(max)
const ID = z.string().regex(/^[a-z0-9-]{1,40}$/)
const VERSION = /^\d+\.\d+\.\d+$/

/** A CSS custom property the header publishes or reads, by name. */
const MEASURE = z.string().regex(/^--[a-z0-9-]{1,40}$/)

const Named = z.object({ name: text(80), note: text(200).optional() }).strict()
const caption = text(1000).optional()

/** The bar, part by part: the drawing keys on the part, the words are the file's. */
const AnatomySchema = z
  .object({
    heading: text(120),
    barLabel: text(80),
    parts: z.object({ logo: Named, worlds: Named, developers: Named, language: Named, credits: Named, account: Named }).strict(),
    caption,
  })
  .strict()

/** The header's own parts, and what it reaches from a product's page (drawn around the product map). */
const RuntimeSchema = z
  .object({
    inside: z.array(Named).min(1).max(6),
    toProducts: text(120),
    fromPages: text(120),
    services: z
      .array(z.object({ name: text(60), address: text(60).optional(), via: text(80).optional(), note: text(200).optional() }).strict())
      .min(1)
      .max(6),
    caption,
  })
  .strict()

const WorldsFigureSchema = z
  .object({
    heading: text(120),
    listLabel: text(80),
    groups: z.object({ simple: Named, advanced: Named }).strict(),
    toProducts: text(120),
    toDestinations: text(120),
    caption,
  })
  .strict()

const ReleaseSchema = z
  .object({
    heading: text(120),
    lanes: z
      .array(
        z
          .object({
            name: text(60),
            where: text(80).optional(),
            steps: z
              .array(z.object({ name: text(120), gate: text(160).optional(), strong: z.boolean().optional() }).strict())
              .min(1)
              .max(8),
          })
          .strict(),
      )
      .min(1)
      .max(3),
    caption,
  })
  .strict()

const Band = z.object({ name: text(80), detail: text(80).optional(), measure: MEASURE.optional(), note: text(120).optional() }).strict()

/** The phone, slot by slot, top to bottom; the accessibility button's lift beside it. */
const PhoneSchema = z
  .object({
    heading: text(120),
    header: Band,
    page: Band,
    productBar: Band,
    bottomBar: Band,
    a11y: z.object({ measure: MEASURE.optional(), note: text(160).optional() }).strict(),
    caption,
  })
  .strict()

const ContractSchema = z
  .object({
    heading: text(120),
    columns: z
      .array(z.object({ title: text(80), items: z.array(Named).min(1).max(10) }).strict())
      .min(1)
      .max(3),
    caption,
  })
  .strict()

/** Each figure is optional; the page draws the ones the file gives, in its own order. */
const FiguresSchema = z
  .object({
    anatomy: AnatomySchema.optional(),
    runtime: RuntimeSchema.optional(),
    worlds: WorldsFigureSchema.optional(),
    release: ReleaseSchema.optional(),
    phone: PhoneSchema.optional(),
    contract: ContractSchema.optional(),
  })
  .strict()

const https = (href: string): boolean => {
  try {
    return new URL(href).protocol === "https:"
  } catch {
    return false
  }
}

const WorldSchema = z
  .object({
    id: ID,
    label: text(60),
    href: z.string().max(300).refine(https, "must be an https address"),
    group: z.enum(["simple", "advanced"]),
  })
  .strict()

const unique = <T>(rows: readonly T[], key: (row: T) => string): boolean => new Set(rows.map(key)).size === rows.length

const MapSchema = z
  .object({
    asOf: z.string().regex(VERSION),
    figures: FiguresSchema,
    worlds: z.array(WorldSchema).max(30).refine((rows) => unique(rows, (row) => row.id), "two worlds share an id"),
  })
  .strict()

type ParsedMap = z.infer<typeof MapSchema>

/** The file's text as the page's map, or why it cannot be one. */
export function parseHeaderMap(source: string): { map: ParsedMap } | { problem: string } {
  if (Buffer.byteLength(source, "utf8") > MAX_BYTES) return { problem: `${MAP_FILE} is larger than ${MAX_BYTES / 1000} KB.` }
  let json: unknown
  try {
    json = JSON.parse(source)
  } catch {
    return { problem: `${MAP_FILE} is not valid JSON.` }
  }
  const parsed = MapSchema.safeParse(json)
  if (parsed.success) return { map: parsed.data }
  const issue = parsed.error.issues[0]
  const where = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""
  return { problem: `${MAP_FILE} does not have the shape this page reads (${where}${issue?.message ?? "invalid"}).` }
}

/** The header's map from its repository, each world's address asked; `null` GitHub: no token. */
export async function readHeaderMap(github: GitHubReader | null, probe: ProbeLink): Promise<HeaderMapResult> {
  if (!github) return { status: "not_configured" }
  let source: string | null
  try {
    source = await github.currentFile(HEADER_REPO, MAP_FILE)
  } catch (error) {
    return failure(error, "the header's explanations")
  }
  if (source === null) return { status: "missing" }
  const read = parseHeaderMap(source)
  if ("problem" in read) return { status: "error", message: read.problem }
  const { asOf, figures, worlds } = read.map
  return { status: "ok", asOf, url: `https://github.com/${HEADER_REPO}/blob/HEAD/${MAP_FILE}`, figures, worlds: await checkWorlds(worlds, probe) }
}
