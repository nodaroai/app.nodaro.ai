import { createHash, randomUUID } from "node:crypto"

/**
 * An in-memory stand-in for the Supabase client, for booted-app tests of the
 * OAuth and MCP lanes (routes/__tests__/mcp-listed-clients*.test.ts). It knows
 * the tables a sign-in touches — `developer_apps`, `developer_app_authorizations`,
 * `developer_app_tokens`, `api_tokens`, `profiles` — and the one embedded read the
 * auth hook makes (a token with its authorization and app, both `!inner`).
 * A test may seed any other table in `db.extra`; every table it does not seed
 * reads as empty: one row → null, a list → [].
 *
 * Filters: `eq` and `is` narrow the known tables; every other filter method is
 * accepted and ignored (no test here depends on one). `db.calls` records every
 * query, so a test can prove a request read nothing. `db.failReads` makes every
 * read of the named tables answer an error.
 *
 * Reads nothing from disk: it is a plain module.
 */

export type Row = Record<string, unknown>

export interface OAuthMemoryDb {
  apps: Row[]
  authorizations: Row[]
  tokens: Row[]
  apiTokens: Row[]
  profiles: Row[]
  /** Supabase session JWT → user id, answered by `auth.getUser`. */
  sessions: Map<string, string>
  /** Any other table a test seeds (e.g. `published_apps`); `eq` and `is` narrow it too. */
  extra: Record<string, Row[]>
  calls: Array<{ table: string; op: string; eqs: Record<string, unknown> }>
  failReads: Set<string>
}

export function newOAuthMemoryDb(): OAuthMemoryDb {
  return { apps: [], authorizations: [], tokens: [], apiTokens: [], profiles: [], sessions: new Map(), extra: {}, calls: [], failReads: new Set() }
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

type Op = "select" | "update" | "insert" | "upsert" | "delete"
type Result = { data: unknown; error: { code?: string; message: string } | null; count?: number | null }

const PASS_THROUGH = [
  "order", "limit", "range", "gte", "gt", "lte", "lt", "neq", "in", "overlaps", "contains", "textSearch", "not", "or", "filter", "match", "ilike", "like",
] as const

function tableRows(db: OAuthMemoryDb, table: string): Row[] | null {
  switch (table) {
    case "developer_apps": return db.apps
    case "developer_app_authorizations": return db.authorizations
    case "developer_app_tokens": return db.tokens
    case "api_tokens": return db.apiTokens
    case "profiles": return db.profiles
    default: return db.extra[table] ?? null
  }
}

class Query {
  private op: Op = "select"
  private payload: unknown
  private returning = false
  private headCount = false
  private readonly eqs: Record<string, unknown> = {}
  private readonly nulls: Record<string, boolean> = {}

  constructor(private readonly db: OAuthMemoryDb, private readonly table: string) {
    for (const m of PASS_THROUGH) (this as unknown as Record<string, unknown>)[m] = () => this
  }

  select(_columns?: string, opts?: { count?: string; head?: boolean }): this {
    if (this.op === "select") this.headCount = opts?.head === true
    else this.returning = true
    return this
  }
  update(values: unknown): this { this.op = "update"; this.payload = values; return this }
  insert(values: unknown): this { this.op = "insert"; this.payload = values; return this }
  upsert(values: unknown): this { this.op = "upsert"; this.payload = values; return this }
  delete(): this { this.op = "delete"; return this }
  eq(column: string, value: unknown): this { this.eqs[column] = value; return this }
  is(column: string, value: unknown): this { this.nulls[column] = value === null; return this }

  maybeSingle(): Promise<Result> { return Promise.resolve(this.run("maybeSingle")) }
  single(): Promise<Result> { return Promise.resolve(this.run("single")) }
  then<T>(resolve: (r: Result) => T, reject?: (e: unknown) => T): Promise<T> {
    return Promise.resolve(this.run("many")).then(resolve, reject)
  }

  private matches(row: Row): boolean {
    for (const [k, v] of Object.entries(this.eqs)) if (row[k] !== v) return false
    for (const [k, wantsNull] of Object.entries(this.nulls)) {
      const isNull = row[k] === null || row[k] === undefined
      if (isNull !== wantsNull) return false
    }
    return true
  }

  private run(shape: "maybeSingle" | "single" | "many"): Result {
    this.db.calls.push({ table: this.table, op: this.op, eqs: { ...this.eqs } })
    if (this.op === "select" && this.db.failReads.has(this.table)) {
      return { data: null, error: { code: "XX000", message: `read of ${this.table} failed` } }
    }
    const rows = tableRows(this.db, this.table)
    switch (this.op) {
      case "select": {
        const found = rows === null ? [] : this.table === "developer_app_tokens" ? this.tokensWithJoin() : rows.filter((r) => this.matches(r))
        if (this.headCount) return { data: null, error: null, count: found.length }
        return this.shape(found, shape)
      }
      case "update": {
        const hit = rows === null ? [] : rows.filter((r) => this.matches(r))
        for (const r of hit) Object.assign(r, this.payload as Row)
        return this.returning ? this.shape(hit, shape) : { data: null, error: null }
      }
      case "delete": {
        if (rows === null) return { data: [], error: null }
        const hit = rows.filter((r) => this.matches(r))
        for (const r of hit) rows.splice(rows.indexOf(r), 1)
        return this.returning ? this.shape(hit, shape) : { data: null, error: null }
      }
      case "insert": {
        const row: Row = { id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), kind: "user", status: "active", ...(this.payload as Row) }
        rows?.push(row)
        return this.returning ? this.shape([row], shape) : { data: null, error: null }
      }
      case "upsert": {
        const values = this.payload as Row
        if (rows === null) return { data: null, error: null }
        let row = this.table === "developer_app_authorizations" ? rows.find((r) => r.app_id === values.app_id && r.user_id === values.user_id) : undefined
        if (row) Object.assign(row, values)
        else {
          row = { id: randomUUID(), created_at: new Date().toISOString(), ...values }
          rows.push(row)
        }
        return this.returning ? this.shape([row], shape) : { data: null, error: null }
      }
    }
  }

  private shape(found: Row[], shape: "maybeSingle" | "single" | "many"): Result {
    if (shape === "many") return { data: found, error: null }
    if (found.length === 1) return { data: found[0], error: null }
    if (shape === "maybeSingle" && found.length === 0) return { data: null, error: null }
    return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } }
  }

  /** `developer_app_tokens` with its authorization and that authorization's app, both `!inner`. */
  private tokensWithJoin(): Row[] {
    const out: Row[] = []
    for (const token of this.db.tokens.filter((r) => this.matches(r))) {
      const authorization = this.db.authorizations.find((a) => a.id === token.authorization_id)
      if (!authorization) continue
      const app = this.db.apps.find((a) => a.id === authorization.app_id)
      if (!app) continue
      out.push({
        ...token,
        developer_app_authorizations: {
          ...authorization,
          monthly_spend_cap_credits: authorization.monthly_spend_cap_credits ?? null,
          developer_apps: { kind: app.kind ?? "user", owner_user_id: app.owner_user_id ?? null },
        },
      })
    }
    return out
  }
}

export function oauthMemorySupabase(db: OAuthMemoryDb) {
  return {
    from: (table: string) => new Query(db, table),
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: {
      getUser: async (jwt: string) => {
        const id = db.sessions.get(jwt)
        return id
          ? { data: { user: { id, app_metadata: {}, user_metadata: {} } }, error: null }
          : { data: { user: null }, error: { message: "invalid JWT" } }
      },
    },
  }
}

/** A developer app row, as `POST /v1/developer-apps` (kind "user") or dynamic registration would store it. */
export function appRow(over: Partial<Row> & { client_id: string }): Row {
  return {
    id: randomUUID(),
    owner_user_id: null,
    name: "Test client",
    description: null,
    logo_url: null,
    homepage_url: null,
    redirect_uris: ["https://client.example/cb"],
    allowed_origins: [],
    scopes_requested: ["jobs:read", "assets:read", "assets:write"],
    client_secret_hash: "unused",
    status: "active",
    kind: "user",
    created_at: "2026-11-11T00:00:00.000Z",
    ...over,
  }
}

/** Seed one consented authorization and an access token for it; returns the bearer. */
export function seedAppToken(db: OAuthMemoryDb, app: Row, userId: string, scopes: string[] = ["jobs:read", "assets:read", "assets:write"]): string {
  const bearer = `ndr_app_${randomUUID().replace(/-/g, "")}`
  const authorization = { id: randomUUID(), app_id: app.id, user_id: userId, scopes_granted: scopes, revoked_at: null, monthly_spend_cap_credits: null }
  db.authorizations.push(authorization)
  db.tokens.push({ id: randomUUID(), authorization_id: authorization.id, token_hash: sha256Hex(bearer), expires_at: null, revoked_at: null })
  return bearer
}

/** Seed a personal API token; returns the bearer. */
export function seedApiToken(db: OAuthMemoryDb, userId: string): string {
  const bearer = `ndr_${"a".repeat(32)}${randomUUID().replace(/-/g, "").slice(0, 32)}`
  db.apiTokens.push({ id: randomUUID(), user_id: userId, workflow_ids: [], rate_limit: 30, token_hash: sha256Hex(bearer), is_active: true, workspace_id: null })
  return bearer
}
