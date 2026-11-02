/**
 * Import source policies (migration 578): what an admin decided about each
 * site a link may come from, read before a link is downloaded. A site with no
 * row is approved (decided 2026-11-02: every platform starts approved). A
 * `disabled` or `permission_required` site is refused with ONE generic
 * message that names no site and does not say whether the site is listed —
 * the list is the admin's. (There is no way to grant a permission yet:
 * `permission_required` refuses like `disabled` until that lands.)
 *
 * Checked in the same two places as the content rights confirmation
 * (`lib/content-rights.ts`): the `/v1/download-video` route and a run's own
 * download, on the host of the link AS SUBMITTED. A link that redirects to
 * another host, a mirror or a second host of the same platform is matched on
 * the host the person pasted, so an admin lists every host a platform uses.
 *
 * The list is cached a minute per process: a save takes effect within a
 * minute on every replica and worker (the admin screen says so). A read that
 * fails serves the rows read last; before any read succeeded it serves none
 * (every site approved, the default) and logs the failure.
 */
import { supabase } from "./supabase.js"

export const IMPORT_SOURCE_STATUSES = ["approved", "restricted", "permission_required", "disabled", "pending_legal_review"] as const
export type ImportSourceStatus = (typeof IMPORT_SOURCE_STATUSES)[number]

/** A domain as the table keeps it: labels of letters, digits and hyphens, a TLD, punycode for an international name. */
export const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$/

export interface ImportSourcePolicy {
  domain: string
  status: ImportSourceStatus
  note: string | null
  updatedBy: string | null
  updatedAt: string
}

export class ImportSourceError extends Error {
  readonly code = "import_source_disabled" as const
  constructor() {
    super("This link can't be imported here.")
    this.name = "ImportSourceError"
  }
}

/** A save made against a list that moved since it was loaded. */
export class ImportSourceVersionError extends Error {
  readonly code = "import_sources_changed" as const
  constructor() {
    super("The import sources changed since they were loaded. Reload and try again.")
    this.name = "ImportSourceVersionError"
  }
}

const CACHE_MS = 60_000
let cache: { rows: ImportSourcePolicy[]; at: number } | null = null

/** A domain as the table keeps it: lowercase, every leading `www.` and a trailing dot gone. */
export function normalizeDomain(input: string): string {
  return input.trim().toLowerCase().replace(/\.+$/, "").replace(/^(www\.)+/, "")
}

/** The list's version, the same string `import_source_policies_version()` answers in the database. */
export function policiesVersion(rows: readonly ImportSourcePolicy[]): string {
  const newest = rows.reduce((max, r) => Math.max(max, Date.parse(r.updatedAt)), 0)
  return `${rows.length}:${rows.length ? Math.floor(newest) : 0}`
}

/**
 * The list. Cached a minute (what a download checks); `fresh` reads the table
 * now (what the admin screen loads, so a reload after a refused save sees the
 * list as it is).
 */
export async function listImportSourcePolicies(options: { fresh?: boolean } = {}): Promise<ImportSourcePolicy[]> {
  if (!options.fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.rows
  const { data, error } = await supabase.from("import_source_policies").select("domain, status, note, updated_by, updated_at").order("domain")
  if (error) {
    console.error(`[import-source-policy] read failed, serving the rows read last: ${error.message}`)
    if (cache) return cache.rows
    return []
  }
  const rows = ((data ?? []) as Array<{ domain: string; status: ImportSourceStatus; note: string | null; updated_by: string | null; updated_at: string }>).map((r) => ({
    domain: r.domain,
    status: r.status,
    note: r.note,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  }))
  cache = { rows, at: Date.now() }
  return rows
}

export function forgetImportSourceCache(): void {
  cache = null
}

/** The row that covers `host` (the host itself or its nearest listed parent), or null. */
export function policyForHost(host: string, rows: readonly ImportSourcePolicy[]): ImportSourcePolicy | null {
  const h = normalizeDomain(host)
  let best: ImportSourcePolicy | null = null
  for (const row of rows) {
    if (h === row.domain || h.endsWith(`.${row.domain}`)) {
      if (!best || row.domain.length > best.domain.length) best = row
    }
  }
  return best
}

/** The status the link's site has; `approved` when nothing is listed for it. */
export async function importSourceStatus(url: string): Promise<ImportSourceStatus> {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return "approved"
  }
  const row = policyForHost(host, await listImportSourcePolicies())
  return row?.status ?? "approved"
}

/** Throws `ImportSourceError` when the link's site may not be imported from. */
export async function assertImportSourceAllowed(url: string): Promise<void> {
  const status = await importSourceStatus(url)
  if (status === "disabled" || status === "permission_required") throw new ImportSourceError()
}

export interface ImportSourcePolicyInput {
  /** Already normalized (`normalizeDomain`) and matching `DOMAIN_RE`. */
  domain: string
  status: ImportSourceStatus
  note?: string | null
}

/**
 * Replaces the list whole in one transaction (an admin's save): rows named
 * stay or change, the rest go. `expectedVersion` is the version the admin
 * loaded (`policiesVersion`); a list that moved since refuses with
 * `ImportSourceVersionError`.
 */
export async function replaceImportSourcePolicies(inputs: readonly ImportSourcePolicyInput[], adminUserId: string | null, expectedVersion: string): Promise<ImportSourcePolicy[]> {
  const policies = inputs.map((p) => ({ domain: p.domain, status: p.status, note: p.note?.trim() || null }))
  const { error } = await supabase.rpc("replace_import_source_policies", { p_policies: policies, p_admin: adminUserId, p_expected_version: expectedVersion })
  if (error) {
    if (error.code === "40001") throw new ImportSourceVersionError()
    throw new Error(`[import-source-policy] write failed: ${error.message}`)
  }
  forgetImportSourceCache()
  return listImportSourcePolicies({ fresh: true })
}
