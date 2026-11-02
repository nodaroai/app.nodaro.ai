import type { DeploymentRecord, DeploymentState, DeploymentStatus } from "./deployed.js"

/**
 * The few GitHub reads the header versions page needs, with a read-only
 * token: a repository's deployments and their status histories, one file at
 * one commit, and a repository's tags.
 *
 * Every list is asked again on each build — a status can change at any time —
 * but conditionally: the last answer's ETag goes with the request, and GitHub's
 * 304 (which does not count against the rate limit) means "unchanged".
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** A GitHub refusal or an unreachable GitHub; `status` is `null` when no answer came. */
export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
    this.name = "GitHubError"
  }
}

const API = "https://api.github.com"
const TIMEOUT_MS = 10_000
/** Answers kept for their ETag; the oldest goes when full. */
const ETAGS_KEPT = 500
const STATES: ReadonlySet<string> = new Set<DeploymentState>(["success", "failure", "error", "inactive", "in_progress", "queued", "pending"])

export interface GitHubReader {
  deployments(repo: string, query: { environment?: string; perPage: number; page?: number }): Promise<DeploymentRecord[]>
  /** A deployment's statuses, newest first. */
  statuses(repo: string, deploymentId: number): Promise<DeploymentStatus[]>
  /** The file's text at `ref`, or `null` when the commit has no such file. */
  fileAt(repo: string, path: string, ref: string): Promise<string | null>
  tags(repo: string): Promise<string[]>
}

const asArray = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => v !== null && typeof v === "object") : [])

/** GitHub's own words when it refuses: a bad token, a repository the token cannot see, a spent rate limit. */
async function refusal(res: Response): Promise<GitHubError> {
  const body = (await res.json().catch(() => null)) as { message?: unknown } | null
  const said = typeof body?.message === "string" ? body.message : `HTTP ${res.status}`
  return new GitHubError(`GitHub answered ${res.status}: ${said}`, res.status)
}

interface Transport {
  /** One authorized request; the caller reads the answer. */
  send(path: string, accept: string, etag?: string): Promise<Response>
  /** A JSON list or object, asked conditionally on the last answer's ETag. */
  json(path: string): Promise<unknown>
}

function createTransport(token: string, fetch: FetchLike): Transport {
  const kept = new Map<string, { readonly etag: string; readonly body: unknown }>()

  async function send(path: string, accept: string, etag?: string): Promise<Response> {
    const headers = { authorization: `Bearer ${token}`, accept, "x-github-api-version": "2022-11-28", "user-agent": "nodaro-admin-header-versions" }
    try {
      return await fetch(`${API}${path}`, { headers: etag ? { ...headers, "if-none-match": etag } : headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch {
      throw new GitHubError("Could not reach GitHub.", null)
    }
  }

  async function json(path: string): Promise<unknown> {
    const previous = kept.get(path)
    const res = await send(path, "application/vnd.github+json", previous?.etag)
    if (res.status === 304 && previous) return previous.body
    if (!res.ok) throw await refusal(res)
    const body: unknown = await res.json()
    const etag = res.headers.get("etag")
    kept.delete(path)
    if (etag) kept.set(path, { etag, body })
    if (kept.size > ETAGS_KEPT) kept.delete(kept.keys().next().value as string)
    return body
  }

  return { send, json }
}

const toDeployment = (row: Record<string, unknown>): DeploymentRecord[] =>
  typeof row.id === "number" && typeof row.environment === "string" && typeof row.sha === "string" && typeof row.created_at === "string"
    ? [{ id: row.id, environment: row.environment, sha: row.sha, createdAt: row.created_at }]
    : []

const toStatus = (row: Record<string, unknown>): DeploymentStatus => ({
  state: typeof row.state === "string" && STATES.has(row.state) ? (row.state as DeploymentState) : "unknown",
  at: typeof row.created_at === "string" ? row.created_at : null,
})

const statusTime = (status: DeploymentStatus): number => (status.at ? Date.parse(status.at) : Number.NEGATIVE_INFINITY)

/** A reader over GitHub's REST API with `token`; `deps.fetch` is a test seam. */
export function createGitHubReader(token: string, deps: { fetch?: FetchLike } = {}): GitHubReader {
  const http = createTransport(token, deps.fetch ?? ((url, init) => globalThis.fetch(url, init)))
  return {
    async deployments(repo, { environment, perPage, page = 1 }) {
      const query = new URLSearchParams({ per_page: String(perPage), page: String(page), ...(environment ? { environment } : {}) })
      return asArray(await http.json(`/repos/${repo}/deployments?${query}`)).flatMap(toDeployment)
    },
    async statuses(repo, deploymentId) {
      const history = asArray(await http.json(`/repos/${repo}/deployments/${deploymentId}/statuses?per_page=100`)).map(toStatus)
      // GitHub answers newest first; ordered here too, so the rule never rests on that alone.
      return [...history].sort((a, b) => statusTime(b) - statusTime(a))
    },
    async fileAt(repo, path, ref) {
      const res = await http.send(`/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`, "application/vnd.github.raw+json")
      if (res.status === 404) return null
      if (!res.ok) throw await refusal(res)
      return res.text()
    },
    async tags(repo) {
      return asArray(await http.json(`/repos/${repo}/tags?per_page=100`)).flatMap((row) => (typeof row.name === "string" ? [row.name] : []))
    },
  }
}
