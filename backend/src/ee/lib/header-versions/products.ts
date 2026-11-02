import { z } from "zod"

/**
 * The products that show the shared header, and where each one says which
 * version it carries. The list is the deployment's own setting
 * (`HEADER_VERSIONS_PRODUCTS`), never written here: it names private
 * repositories and test hosts, and this code is published. The header's
 * package name is not written here either: it is read from the header's own
 * repository (`HEADER_REPO`'s package.json).
 *
 * - `lockfile`: the version is fixed by the deployed commit — the product's
 *   `package-lock.json` (its `package.json` may declare a range).
 * - `site-file`: the version also depends on the environment's own build
 *   settings (this app installs the header at image build time, and only some
 *   environments turn it on), so the built site publishes what it installed at
 *   `/shell-version.json` (written by `frontend/src/ee/shell/header-module-plugin.ts`).
 *   The deployed commit's pin in `install-package.sh` is the fallback until a
 *   site serves the file.
 *
 * Every repository posts a GitHub deployment per environment when it deploys;
 * that is where the deployed commit comes from (`deployed.ts`).
 */

export type HeaderSource = "lockfile" | "site-file"

export type SiteEnvironment = "production" | "staging"

export interface HeaderProduct {
  readonly id: string
  readonly label: string
  /** `owner/name` on GitHub. */
  readonly repo: string
  /** The host each environment is served on. */
  readonly hosts: Readonly<Record<SiteEnvironment, string>>
  readonly source: HeaderSource
  /** The picture the page shows for the product, by name; the page draws its first letter for a name it does not know, or none. */
  readonly icon: string | null
}

/** The header's own repository: its releases are tagged there (`v<version>`), and its package.json names the package. */
export const HEADER_REPO = "nodaroai/shell"
/** The file a `site-file` product serves at its root. */
export const SITE_FILE = "shell-version.json"
/** The pin a `site-file` product's commit carries. */
export const PIN_FILE = "frontend/src/ee/shell/install-package.sh"

/** A bare host name (no scheme, port or path): the page only ever asks `https://<host>/…`. */
const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

const EntrySchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9-]{1,40}$/),
  label: z.string().trim().min(1).max(40),
  repo: z.string().trim().regex(/^[\w.-]+\/[\w.-]+$/),
  production: z.string().trim().toLowerCase().regex(HOST),
  staging: z.string().trim().toLowerCase().regex(HOST),
  source: z.enum(["lockfile", "site-file"]),
  icon: z.string().trim().regex(/^[a-z0-9-]{1,40}$/).optional(),
})

export interface ParsedProducts {
  readonly products: readonly HeaderProduct[]
  /** Entries refused, by position — shown on the page, never asked about. */
  readonly invalid: readonly { readonly index: number; readonly reason: string }[]
}

/**
 * `HEADER_VERSIONS_PRODUCTS`: a JSON array of
 * `{ id, label, repo, production, staging, source, icon? }`. Malformed JSON lists no
 * products and says so; a bad entry is refused alone; a repeated id keeps the
 * first.
 */
export function parseHeaderProducts(raw: string | undefined): ParsedProducts {
  if (!raw || raw.trim() === "") return { products: [], invalid: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { products: [], invalid: [{ index: -1, reason: "HEADER_VERSIONS_PRODUCTS is not valid JSON." }] }
  }
  if (!Array.isArray(parsed)) return { products: [], invalid: [{ index: -1, reason: "HEADER_VERSIONS_PRODUCTS must be a JSON array." }] }
  return parsed.reduce<ParsedProducts>(
    (acc, item, index) => {
      const entry = EntrySchema.safeParse(item)
      if (!entry.success) {
        const issue = entry.error.issues[0]
        return { ...acc, invalid: [...acc.invalid, { index, reason: issue ? `${issue.path.join(".") || "entry"}: ${issue.message}` : "invalid entry" }] }
      }
      if (acc.products.some((p) => p.id === entry.data.id)) return { ...acc, invalid: [...acc.invalid, { index, reason: `id "${entry.data.id}" is repeated` }] }
      const { production, staging, icon, ...rest } = entry.data
      return { ...acc, products: [...acc.products, { ...rest, hosts: { production, staging }, icon: icon ?? null }] }
    },
    { products: [], invalid: [] },
  )
}
