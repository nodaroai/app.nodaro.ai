import { throwFromResponse } from "./errors.js"
import type { Auth } from "./auth.js"
import { WorkflowsResource } from "./resources/workflows.js"
import { ProjectsResource } from "./resources/projects.js"
import { JobsResource } from "./resources/jobs.js"
import { ExecutionsResource } from "./resources/executions.js"
import { NodesResource } from "./resources/nodes.js"
import { DeveloperAppsResource } from "./resources/developer-apps.js"
import { OAuthResource } from "./resources/oauth.js"
import { AppsResource } from "./resources/apps.js"
import { CharactersResource } from "./resources/characters.js"
import { LocationsResource } from "./resources/locations.js"

export interface ClientOptions {
  /** Backend base URL, e.g. "https://nodaro.example.com" or empty string for same-origin. */
  baseUrl: string
  /** Auth provider. Use StaticTokenAuth, supabaseAuth, or CallbackAuth. */
  auth: Auth
  /** Optional fetch override (for tests or custom transports). */
  fetch?: typeof fetch
  /** Default request timeout in ms. Default 60s. */
  timeoutMs?: number
}

interface RequestOptions {
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
  headers?: Record<string, string>
  signal?: AbortSignal
}

export class NodaroClient {
  readonly baseUrl: string
  readonly auth: Auth
  readonly timeoutMs: number
  private readonly fetchOverride: typeof fetch | undefined

  /**
   * Resolved lazily so consumers can swap `globalThis.fetch` after the
   * client has been constructed (e.g. test mocks). Always rebound to the
   * global object — native fetch throws "Illegal invocation" when its
   * `this` is anything else.
   */
  get fetch(): typeof fetch {
    return this.fetchOverride ?? globalThis.fetch.bind(globalThis)
  }

  readonly workflows: WorkflowsResource
  readonly projects: ProjectsResource
  readonly jobs: JobsResource
  readonly executions: ExecutionsResource
  readonly nodes: NodesResource
  readonly developerApps: DeveloperAppsResource
  readonly oauth: OAuthResource
  readonly apps: AppsResource
  readonly characters: CharactersResource
  readonly locations: LocationsResource

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "")  // strip trailing slash
    this.auth = opts.auth
    this.fetchOverride = opts.fetch
    this.timeoutMs = opts.timeoutMs ?? 60_000

    this.workflows = new WorkflowsResource(this)
    this.projects = new ProjectsResource(this)
    this.jobs = new JobsResource(this)
    this.executions = new ExecutionsResource(this)
    this.nodes = new NodesResource(this)
    this.developerApps = new DeveloperAppsResource(this)
    this.oauth = new OAuthResource(this)
    this.apps = new AppsResource(this)
    this.characters = new CharactersResource(this)
    this.locations = new LocationsResource(this)
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.query)

    const token = await this.auth.getToken()
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    }
    if (token) headers["Authorization"] = `Bearer ${token}`

    const ac = new AbortController()
    const timeoutId = setTimeout(() => ac.abort(), this.timeoutMs)
    if (options.signal) {
      options.signal.addEventListener("abort", () => ac.abort(), { once: true })
    }

    try {
      const res = await this.fetch(url, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: ac.signal,
      })

      if (!res.ok) {
        let errBody: Record<string, unknown> = {}
        try {
          errBody = await res.json() as Record<string, unknown>
        } catch {
          // Empty/non-JSON body — fall through with empty errBody
        }
        throwFromResponse(res.status, errBody)
      }

      // 204 No Content
      if (res.status === 204) return undefined as T
      return await res.json() as T
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const base = this.baseUrl || (typeof window !== "undefined" ? window.location.origin : "http://placeholder")
    const url = new URL(path, base)
    // If baseUrl was empty, strip the placeholder origin
    const fullUrl = this.baseUrl ? url.toString() : url.pathname + url.search
    if (query) {
      const u = new URL(this.baseUrl ? fullUrl : fullUrl, base)
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) u.searchParams.set(k, String(v))
      }
      return this.baseUrl ? u.toString() : u.pathname + u.search
    }
    return fullUrl
  }
}

/** Factory function — preferred entry point. */
export function createClient(opts: ClientOptions): NodaroClient {
  return new NodaroClient(opts)
}
