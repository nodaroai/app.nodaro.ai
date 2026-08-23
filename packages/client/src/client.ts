import { throwFromResponse } from "./errors.js"
import type { Auth } from "./auth.js"
import { WorkflowsResource } from "./resources/workflows.js"
import { ProjectsResource } from "./resources/projects.js"
import { JobsResource } from "./resources/jobs.js"
import { VideoProResource } from "./resources/video-pro.js"
import { ExecutionsResource } from "./resources/executions.js"
import { NodesResource } from "./resources/nodes.js"
import { DeveloperAppsResource } from "./resources/developer-apps.js"
import { OAuthResource } from "./resources/oauth.js"
import { AppsResource } from "./resources/apps.js"
import { CharactersResource } from "./resources/characters.js"
import { LocationsResource } from "./resources/locations.js"
import { ObjectsResource } from "./resources/objects.js"
import { CreaturesResource } from "./resources/creatures.js"
import { PipelinesResource } from "./resources/pipelines.js"
import { ReduceResource } from "./resources/reduce.js"
import { PromptHelperResource } from "./resources/prompt-helper.js"
import { VoicesResource } from "./resources/voices.js"
import { MediaResource } from "./resources/media.js"
import { AudioResource } from "./resources/audio.js"
import { CreditsResource } from "./resources/credits.js"
import { UploadsResource } from "./resources/uploads.js"
import { LibraryResource } from "./resources/library.js"
import { PresetsResource } from "./resources/node-presets.js"
import { PickerCatalogsResource } from "./resources/picker-catalogs.js"
import { ModelsResource } from "./resources/models.js"
import { ShotsResource } from "./resources/shots.js"
import { RecastResource } from "./resources/recast.js"
import { CommunityResource } from "./resources/community.js"
import { TemplatesResource } from "./resources/templates.js"
import { TutorialsResource } from "./resources/tutorials.js"
import { OrganizationsResource } from "./resources/organizations.js"
import { WorkspacesResource } from "./resources/workspaces.js"
import { WORKSPACE_HEADER, type MeOrganizations } from "@nodaro/shared"

/** Replaced at build time by tsup `define` from package.json. The fallback
 *  keeps `tsx`/vitest runs of the source working, where no define applies. */
declare const __SDK_VERSION__: string | undefined
const SDK_VERSION = typeof __SDK_VERSION__ === "string" ? __SDK_VERSION__ : "0.0.0-dev"

/**
 * Identifies the calling package to the backend, which records it as the job's
 * provenance (`jobs.source` / `source_detail`) so an operator can tell a CLI
 * run from an SDK integration from a browser session.
 *
 * Only `sdk/…` and `cli/…` are honoured server-side; anything else is ignored
 * rather than trusted, since this is an unauthenticated header.
 */
export const CLIENT_HEADER = "X-Nodaro-Client"

/**
 * In a browser the header is redundant AND a liability, so it is not sent.
 *
 * Redundant: the browser already sends `Origin`, which names the actual product
 * (`studio.nodaro.ai`) rather than merely the library it used — and the backend
 * deliberately prefers Origin over this header, so a browser-sent value is
 * discarded on arrival.
 *
 * A liability: `X-Nodaro-Client` is not a CORS-safelisted request header, so a
 * browser sending it requires an exact match in the server's
 * `Access-Control-Allow-Headers`. Any deployment whose backend predates that
 * allowlist entry would fail the PREFLIGHT — breaking every API call from the
 * app, not just its provenance. Self-hosted and lagging deployments make that a
 * real risk, and nothing in a browser app would reveal the cause.
 *
 * An EXPLICIT `clientLabel` is always sent regardless: a caller that names
 * itself has opted in deliberately, and that intent outranks this default.
 */
const isBrowser = (): boolean => typeof window !== "undefined" && typeof window.document !== "undefined"

export interface ClientOptions {
  /** Backend base URL, e.g. "https://nodaro.example.com" or empty string for same-origin. */
  baseUrl: string
  /** Auth provider. Use StaticTokenAuth, supabaseAuth, or CallbackAuth. */
  auth: Auth
  /** Optional fetch override (for tests or custom transports). */
  fetch?: typeof fetch
  /** Default request timeout in ms. Default 60s. */
  timeoutMs?: number
  /**
   * Overrides the `X-Nodaro-Client` label. Defaults to `sdk/<version>`.
   *
   * Exists for `@nodaro/cli`, which is a wrapper AROUND this SDK: without an
   * override every CLI invocation would be recorded as an SDK call and the two
   * surfaces could never be told apart.
   */
  clientLabel?: string
  /**
   * The workspace every request acts in — sent as `X-Nodaro-Workspace`.
   *
   * It selects which workspace a LIST reads from and where a CREATE lands.
   * It never authorizes: reading, updating, deleting or running an
   * identified object is decided by that object's own workspace, so a
   * forgotten header cannot hide work and a forged one cannot reach anyone
   * else's. Omit it to work in the caller's personal space.
   *
   * Prefer {@link NodaroClient.withWorkspace} for anything short-lived — one
   * client per workspace, no shared mutable selection to get wrong.
   */
  workspaceId?: string
}

interface RequestOptions {
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
  headers?: Record<string, string>
  signal?: AbortSignal
}

/**
 * The authenticated user's canonical identity (`GET /v1/me`). A token-
 * introspection primitive: any valid bearer token (first-party Supabase JWT or
 * a developer-app OAuth token) resolves to its owner's identity. Mirrors the
 * `profiles` identity columns server-side — the route is the source of truth.
 */
export interface UserIdentity {
  /** Nodaro user id (= the Supabase auth user id). */
  readonly id: string
  readonly email: string
  /** Human-readable display name (from `profiles.full_name`); `null` if unset. */
  readonly displayName: string | null
  /** Avatar URL; `null` if unset. */
  readonly avatarUrl: string | null
  /** Subscription tier (e.g. "free", "pro"). */
  readonly tier: string
  /**
   * Whether the user holds an admin role. DESCRIPTIVE only — use it to decide
   * whether to render admin surfaces without capability-probing an admin
   * endpoint; every admin API stays enforced server-side regardless.
   */
  readonly isAdmin: boolean
}

export class NodaroClient {
  readonly baseUrl: string
  readonly auth: Auth
  readonly timeoutMs: number
  /** Value sent as `X-Nodaro-Client`; recorded by the backend as job provenance. */
  readonly clientLabel: string
  /** Whether to actually send it — see the note on {@link CLIENT_HEADER}. */
  private readonly sendClientHeader: boolean
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
  readonly videoPro: VideoProResource
  readonly executions: ExecutionsResource
  readonly nodes: NodesResource
  readonly developerApps: DeveloperAppsResource
  readonly oauth: OAuthResource
  readonly apps: AppsResource
  readonly characters: CharactersResource
  readonly locations: LocationsResource
  readonly objects: ObjectsResource
  readonly creatures: CreaturesResource
  readonly pipelines: PipelinesResource
  readonly reduce: ReduceResource
  readonly promptHelper: PromptHelperResource
  readonly voices: VoicesResource
  readonly media: MediaResource
  readonly audio: AudioResource
  readonly credits: CreditsResource
  readonly uploads: UploadsResource
  readonly library: LibraryResource
  readonly presets: PresetsResource
  readonly pickerCatalogs: PickerCatalogsResource
  readonly models: ModelsResource
  readonly shots: ShotsResource
  readonly recast: RecastResource
  readonly community: CommunityResource
  readonly templates: TemplatesResource
  readonly tutorials: TutorialsResource
  readonly organizations: OrganizationsResource
  readonly workspaces: WorkspacesResource
  /** The workspace this client acts in; undefined = the personal space. */
  readonly workspaceId: string | undefined

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "")  // strip trailing slash
    this.auth = opts.auth
    this.fetchOverride = opts.fetch
    this.timeoutMs = opts.timeoutMs ?? 60_000
    this.clientLabel = opts.clientLabel ?? `sdk/${SDK_VERSION}`
    this.workspaceId = opts.workspaceId
    // Explicit label = deliberate opt-in, always sent. The default is suppressed
    // in browsers — see the note on CLIENT_HEADER.
    this.sendClientHeader = opts.clientLabel !== undefined || !isBrowser()

    this.workflows = new WorkflowsResource(this)
    this.projects = new ProjectsResource(this)
    this.jobs = new JobsResource(this)
    this.videoPro = new VideoProResource(this)
    this.executions = new ExecutionsResource(this)
    this.nodes = new NodesResource(this)
    this.developerApps = new DeveloperAppsResource(this)
    this.oauth = new OAuthResource(this)
    this.apps = new AppsResource(this)
    this.characters = new CharactersResource(this)
    this.locations = new LocationsResource(this)
    this.objects = new ObjectsResource(this)
    this.creatures = new CreaturesResource(this)
    this.pipelines = new PipelinesResource(this)
    this.reduce = new ReduceResource(this)
    this.promptHelper = new PromptHelperResource(this)
    this.voices = new VoicesResource(this)
    this.media = new MediaResource(this)
    this.audio = new AudioResource(this)
    this.credits = new CreditsResource(this)
    this.uploads = new UploadsResource(this)
    this.library = new LibraryResource(this)
    this.presets = new PresetsResource(this)
    this.pickerCatalogs = new PickerCatalogsResource(this)
    this.models = new ModelsResource(this)
    this.shots = new ShotsResource(this)
    this.recast = new RecastResource(this)
    this.community = new CommunityResource(this)
    this.templates = new TemplatesResource(this)
    this.tutorials = new TutorialsResource(this)
    this.organizations = new OrganizationsResource(this)
    this.workspaces = new WorkspacesResource(this)
  }

  /**
   * A client that acts in `workspaceId`, sharing this one's auth and config.
   *
   * A NEW client rather than a setter, deliberately. A mutable selection is
   * the bug this whole axis exists to prevent: two concurrent operations
   * against one client would race over which workspace they were in, and the
   * loser would create work in the wrong place with nothing failing. A
   * per-workspace client cannot be raced.
   *
   * Pass `null` for the personal space.
   */
  withWorkspace(workspaceId: string | null): NodaroClient {
    return new NodaroClient({
      baseUrl: this.baseUrl,
      auth: this.auth,
      timeoutMs: this.timeoutMs,
      ...(this.fetchOverride ? { fetch: this.fetchOverride } : {}),
      ...(this.sendClientHeader ? { clientLabel: this.clientLabel } : {}),
      ...(workspaceId ? { workspaceId } : {}),
    })
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.query)

    const token = await this.auth.getToken()
    // A `FormData` body is a multipart upload: let the runtime set
    // `Content-Type: multipart/form-data; boundary=…` itself (a manual JSON
    // content-type corrupts the boundary), and send the body as-is rather than
    // JSON-stringifying it. Every other body stays JSON, exactly as before.
    const isFormData =
      typeof FormData !== "undefined" && options.body instanceof FormData
    const headers: Record<string, string> = {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(this.sendClientHeader ? { [CLIENT_HEADER]: this.clientLabel } : {}),
      // Before per-request headers: a resource that needs to reach outside
      // this client's workspace says so explicitly and wins.
      ...(this.workspaceId ? { [WORKSPACE_HEADER]: this.workspaceId } : {}),
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
        body:
          options.body === undefined
            ? undefined
            : isFormData
              ? (options.body as FormData)
              : JSON.stringify(options.body),
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

  /**
   * `GET /v1/me` → the authenticated user's identity (see {@link UserIdentity}).
   * Unwraps the `{ data }` envelope. Throws `UnauthorizedError` (401) when the
   * token is missing/invalid, and the SDK's other typed errors as usual.
   *
   * On an instance with organizations it also carries what the caller belongs
   * to. THREE states, and collapsing them is wrong in a way users feel: the
   * organization fields ABSENT means this instance has no organizations at
   * all; present and empty means the account belongs to none; and
   * `organizationsUnavailable` means the lookup failed — keep whatever
   * selection you already had rather than concluding the person was removed
   * from everything.
   */
  async me(): Promise<UserIdentity & MeOrganizations> {
    const res = await this.request<{ data: UserIdentity & MeOrganizations }>("GET", "/v1/me")
    return res.data
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
