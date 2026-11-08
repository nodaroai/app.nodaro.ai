import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { deploymentPayerId } from "../../lib/deployment-payer.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { requireAdmin } from "../middleware/require-admin.js"

/**
 * GET /v1/admin/user-lookup — the accounts an admin picker offers, read on the
 * server. The pickers (Admin › Jobs, App reports, Projects' "All users") used
 * to load `profiles` whole from the browser, capped at 1,000 rows with no
 * order: past 1,000 accounts an arbitrary few could not be found, and an
 * admin past the cap was not hidden by "hide admins". Exactly one of:
 *
 * - `search=<text>`  accounts whose address or name CONTAINS the text
 *   (case-insensitive, LIKE wildcards escaped so `_` and `%` match
 *   themselves), ordered by address, at most `limit` (default 20, max 50);
 * - `email=<address>` the one account with that address (case aside), or none;
 * - `ids=<uuid,…>`    these accounts (at most 200 ids), for labels;
 * - `admins=1`        every admin and super admin, ids and all, uncapped.
 *
 * Each answer is `{ data: AdminUserLite[] }`: id, email, full name, role only.
 * The deployment's payer account is left out for everyone but itself, as on
 * the users page and the online list. It answers an admin signed in to the app
 * only — the pickers' own session, as the browser read it replaces was — never
 * an admin's API token or an app's OAuth token, which `requireAdmin` alone
 * would let search every account's address.
 */

export interface AdminUserLite {
  readonly id: string
  readonly email: string
  readonly fullName: string | null
  readonly role: "user" | "admin" | "super_admin"
}

interface ProfileRow {
  id: string
  email: string | null
  full_name: string | null
  role: string | null
}

/** The reads this route makes, injectable for tests. Every pattern arrives already escaped. */
export interface UserLookupReader {
  /** Rows whose `column` matches the ILIKE `pattern`, ordered by email, at most `limit`. */
  ilike(column: "email" | "full_name", pattern: string, limit: number): Promise<ProfileRow[]>
  byIds(ids: readonly string[]): Promise<ProfileRow[]>
  /** One page of the admin and super admin rows, ordered by id. */
  admins(offset: number, pageSize: number): Promise<ProfileRow[]>
}

const COLUMNS = "id, email, full_name, role"

const IN_APP_ONLY = {
  error: { code: "in_app_only", message: "Accounts are looked up only for an admin signed in to the app." },
}

function unwrap(res: { data: unknown; error: unknown }): ProfileRow[] {
  if (res.error) throw res.error
  return (res.data ?? []) as ProfileRow[]
}

export const databaseReader: UserLookupReader = {
  ilike: async (column, pattern, limit) =>
    unwrap(await supabase.from("profiles").select(COLUMNS).ilike(column, pattern).order("email").limit(limit)),
  byIds: async (ids) => unwrap(await supabase.from("profiles").select(COLUMNS).in("id", [...ids])),
  admins: async (offset, pageSize) =>
    unwrap(
      await supabase
        .from("profiles")
        .select(COLUMNS)
        .in("role", ["admin", "super_admin"])
        .order("id")
        .range(offset, offset + pageSize - 1),
    ),
}

/** `text` as a LIKE pattern body that matches only itself (case aside). */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`)
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const MAX_IDS = 200
/** PostgREST answers at most 1,000 rows a read (supabase/config.toml `max_rows`): the admins are read in pages of it. */
const ADMINS_PAGE = 1000

const lookupQuery = z
  .object({
    search: z.string().trim().min(1).max(100).optional(),
    email: z.string().trim().toLowerCase().pipe(z.email()).optional(),
    ids: z
      .string()
      .optional()
      .transform((v) => (v ? [...new Set(v.split(",").map((s) => s.trim()).filter(Boolean))] : undefined))
      .pipe(z.array(z.uuid()).min(1).max(MAX_IDS).optional()),
    admins: z.literal("1").optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  })
  .refine(
    (v) => [v.search, v.email, v.ids, v.admins].filter((x) => x !== undefined).length === 1,
    { message: "Give exactly one of search, email, ids or admins" },
  )

function toLite(row: ProfileRow): AdminUserLite | null {
  if (!row.email) return null
  const role = row.role === "admin" || row.role === "super_admin" ? row.role : "user"
  return { id: row.id, email: row.email, fullName: row.full_name ?? null, role }
}

function byEmail(a: AdminUserLite, b: AdminUserLite): number {
  return a.email.localeCompare(b.email, undefined, { sensitivity: "base" })
}

async function allAdmins(reader: UserLookupReader): Promise<ProfileRow[]> {
  const rows: ProfileRow[] = []
  for (let offset = 0; ; offset += ADMINS_PAGE) {
    const page = await reader.admins(offset, ADMINS_PAGE)
    rows.push(...page)
    if (page.length < ADMINS_PAGE) return rows
  }
}

export async function adminUserLookupRoutes(
  app: FastifyInstance,
  opts: { reader?: UserLookupReader } = {},
): Promise<void> {
  const reader = opts.reader ?? databaseReader

  app.get("/v1/admin/user-lookup", { preHandler: requireAdmin }, async (req, reply) => {
    if (req.authKind !== "jwt") return reply.status(403).send(IN_APP_ONLY)
    const parsed = lookupQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid query" },
      })
    }
    const { search, email, ids, limit } = parsed.data
    const payerId = deploymentPayerId()
    const hidden = payerId !== null && payerId !== req.userId ? payerId : null

    let rows: ProfileRow[]
    try {
      if (search !== undefined) {
        // Two reads, not one `or=(…)` filter string: the typed text never
        // becomes PostgREST filter syntax, only an escaped ILIKE value.
        const pattern = `%${escapeLike(search)}%`
        const [byAddress, byName] = await Promise.all([
          reader.ilike("email", pattern, limit + 1),
          reader.ilike("full_name", pattern, limit + 1),
        ])
        rows = [...byAddress, ...byName]
      } else if (email !== undefined) {
        // The pattern only narrows (it is the address itself); the comparison decides.
        rows = (await reader.ilike("email", escapeLike(email), 5)).filter(
          (r) => (r.email ?? "").trim().toLowerCase() === email,
        )
      } else if (ids !== undefined) {
        rows = await reader.byIds(ids)
      } else {
        // `admins=1`: the refine above leaves no other case.
        rows = await allAdmins(reader)
      }
    } catch (err) {
      return sendInternalError(reply, req, err, "Lookup failed")
    }

    const seen = new Set<string>()
    const users: AdminUserLite[] = []
    for (const row of rows) {
      if (row.id === hidden || seen.has(row.id)) continue
      const lite = toLite(row)
      if (!lite) continue
      seen.add(row.id)
      users.push(lite)
    }
    users.sort(byEmail)
    return { data: search !== undefined ? users.slice(0, limit) : users }
  })
}
