import { z } from "zod"
import type {
  PackIssue,
  TutorialPackManifest,
  TutorialTemplateDoc,
} from "./types.js"

// --- manifest schema --------------------------------------------------------

const CategorySchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1), // tutorial_categories.name is NOT NULL UNIQUE
  sortOrder: z.number().int().optional(),
})

const ManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  locale: z.string().optional(),
  categories: z.array(CategorySchema),
  forbiddenPromptTerms: z.array(z.string()).optional(),
})

/** Validate an operator-supplied manifest.json. On any structural failure the
 *  whole pack is unusable (its templates reference its categories), so return
 *  `manifest: null` and let the loader skip the pack. */
export function parsePackManifest(
  raw: unknown,
  packLabel: string,
): { manifest: TutorialPackManifest; issues: PackIssue[] } | { manifest: null; issues: PackIssue[] } {
  const parsed = ManifestSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      manifest: null,
      issues: [{ pack: packLabel, severity: "error", code: "manifest_invalid", message: parsed.error.message }],
    }
  }
  return { manifest: parsed.data as TutorialPackManifest, issues: [] }
}

// --- template doc schema ----------------------------------------------------

const DocSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullish(),
  markdownDescription: z.string().nullish(),
  category: z.string().optional(),
  outputTypes: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  complexity: z.string().optional(),
  previewMediaUrl: z.string().nullish(),
  previewMediaType: z.string().nullish(),
  tutorialCategorySlug: z.string().min(1),
  tutorialSortOrder: z.number().int(),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
  settings: z.record(z.string(), z.unknown()).optional(),
})

/** Keys under a node's `data` that hold baked media outputs. Mirrors the
 *  execution-data vocabulary the clone deliberately preserves (Task 1). */
const BAKED_URL_KEYS = ["generatedImageUrl", "generatedVideoUrl", "generatedAudioUrl"] as const

/** A public, reachable https asset URL: https only, host is not localhost or a
 *  private/loopback IP. "sample assets on public URLs" — a clone that opens on
 *  someone else's machine must be able to load them. */
export function isPublicHttpsUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== "https:") return false
  const host = u.hostname.toLowerCase()
  // `URL.hostname` returns IPv6 literals BRACKETED and canonicalized
  // (compressed, lowercase) — e.g. `https://[0:0:0:0:0:0:0:1]/` → `[::1]`,
  // `[FD00::1]` → `[fd00::1]`. Strip the brackets so the address classification
  // below sees the bare address (the old `host === "::1"` never matched).
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host

  if (bare === "localhost" || bare.endsWith(".localhost")) return false
  // IPv4 loopback / unspecified.
  if (bare === "127.0.0.1") return false
  if (bare === "0.0.0.0") return false
  // RFC 1918 private ranges + link-local.
  if (/^10\./.test(bare)) return false
  if (/^192\.168\./.test(bare)) return false
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(bare)) return false
  if (/^169\.254\./.test(bare)) return false
  // IPv6 loopback / unspecified / ULA (fc00::/7) / link-local (fe80::/10).
  if (isPrivateOrLoopbackIpv6(bare)) return false
  return true
}

/** True for an IPv6 literal that must never reach an end-user browser as a
 *  media source: loopback `::1`, unspecified `::`, ULA `fc00::/7` (textual
 *  `fc..`/`fd..`), or link-local `fe80::/10` (textual `fe80`–`febf`). The
 *  `":" ` gate is load-bearing — without it the `fc`/`fd`/`fe8..` prefix checks
 *  would reject ordinary public hostnames like `fd-cdn.example.com`. Relies on
 *  `URL.hostname`'s canonical compressed lowercase form (already applied by the
 *  caller), so no address expansion is needed. */
function isPrivateOrLoopbackIpv6(bare: string): boolean {
  if (!bare.includes(":")) return false // not an IPv6 literal
  if (bare === "::1" || bare === "::") return true
  const firstHextet = bare.split(":")[0]
  if (/^f[cd]/.test(firstHextet)) return true // ULA fc00::/7
  if (/^fe[89ab]/.test(firstHextet)) return true // link-local fe80::/10
  return false
}

/** Every media URL a clone would try to load: preview + each node's baked
 *  result URLs (top-level keys and generatedResults[].url). */
export function collectMediaUrls(doc: TutorialTemplateDoc): string[] {
  const urls: string[] = []
  if (typeof doc.previewMediaUrl === "string" && doc.previewMediaUrl) urls.push(doc.previewMediaUrl)
  for (const node of doc.nodes) {
    const data = (node as { data?: Record<string, unknown> })?.data
    if (!data) continue
    for (const key of BAKED_URL_KEYS) {
      const v = data[key]
      if (typeof v === "string" && v) urls.push(v)
    }
    const results = data.generatedResults
    if (Array.isArray(results)) {
      for (const r of results) {
        const rurl = (r as { url?: unknown })?.url
        if (typeof rurl === "string" && rurl) urls.push(rurl)
      }
    }
  }
  return urls
}

function hasBakedOutput(doc: TutorialTemplateDoc): boolean {
  return collectMediaUrls(doc).length > 0
}

function collectPrompts(doc: TutorialTemplateDoc): string[] {
  const prompts: string[] = []
  for (const node of doc.nodes) {
    const data = (node as { data?: Record<string, unknown> })?.data
    const p = data?.prompt
    if (typeof p === "string" && p) prompts.push(p)
  }
  return prompts
}

/** Validate one operator-supplied template. ERROR issues make the whole pack
 *  unloadable (the loader skips it); WARN issues are advisory and still load. */
export function validatePackDoc(
  raw: unknown,
  manifest: TutorialPackManifest,
): { doc: TutorialTemplateDoc | null; issues: PackIssue[] } {
  const pack = manifest.name
  const parsed = DocSchema.safeParse(raw)
  if (!parsed.success) {
    const slug = (raw as { slug?: string })?.slug
    return {
      doc: null,
      issues: [{ pack, templateSlug: slug, severity: "error", code: "doc_invalid", message: parsed.error.message }],
    }
  }
  const doc = parsed.data as TutorialTemplateDoc
  const issues: PackIssue[] = []
  const at = (severity: PackIssue["severity"], code: string, message: string) =>
    issues.push({ pack, templateSlug: doc.slug, severity, code, message })

  // Rule: category must be declared in the manifest (else the migration-114
  // CHECK — 'tutorial' in listed_in REQUIRES a category — throws at insert).
  const known = new Set(manifest.categories.map((c) => c.slug))
  if (!known.has(doc.tutorialCategorySlug)) {
    at("error", "unknown_category",
      `tutorialCategorySlug "${doc.tutorialCategorySlug}" is not declared in the pack manifest's categories`)
  }

  // Rule: a runnable flow has at least one node. (One node with a baked result
  // is legitimate — do NOT require edges.)
  if (doc.nodes.length === 0) {
    at("error", "empty_flow", "template has no nodes")
  }

  // Rule: every referenced asset is on a public https URL.
  for (const url of collectMediaUrls(doc)) {
    if (!isPublicHttpsUrl(url)) {
      at("error", "non_public_asset", `asset URL is not a public https URL: ${url}`)
    }
  }

  // Rule (WARN): the flagship must open showing its run; a template with no
  // baked output opens as empty grey boxes. Advisory — some tutorials are
  // legitimately input-only.
  if (!hasBakedOutput(doc)) {
    at("warn", "no_baked_output", "template carries no baked demo output; it will open with empty results")
  }

  // Rule (WARN): manifest-declared forbidden prompt terms (real person / named
  // composition). Checkable only as a denylist — see the plan's design decision.
  const terms = (manifest.forbiddenPromptTerms ?? []).map((t) => t.toLowerCase())
  if (terms.length > 0) {
    for (const prompt of collectPrompts(doc)) {
      const lower = prompt.toLowerCase()
      for (const term of terms) {
        if (lower.includes(term)) {
          at("warn", "forbidden_prompt_term", `prompt contains forbidden term "${term}"`)
        }
      }
    }
  }

  // `doc` is returned only when the template is LOADABLE: any ERROR issue
  // (schema handled above, plus the semantic rules here) makes it null, so a
  // caller can treat a non-null doc as "safe to seed" and the loader's
  // whole-pack skip keys off the same errors it reports. WARN issues are
  // advisory and leave the doc intact.
  const hasError = issues.some((i) => i.severity === "error")
  return { doc: hasError ? null : doc, issues }
}
