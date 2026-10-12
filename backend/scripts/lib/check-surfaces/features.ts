/**
 * The feature map: the one hand-kept list the surface checker needs, because
 * the same feature is named differently on each surface (the SDK's
 * `organizations` is the CLI's `org` and the routes' `/v1/orgs`).
 *
 * A feature is an SDK resource property path (`characters`,
 * `workflows.collaborators`), a node type (`node:<type>`), or — for routes no
 * SDK resource claims — a route-only family (`route:<first segment>`). Routes
 * kept off the public surfaces on purpose (admin, webhooks, self-host setup …)
 * that nothing claims land in `_internal`.
 *
 * check-surfaces.test.ts fails when an SDK property, a CLI group or a route's
 * first segment is not accounted for here, so a new one is a decision about
 * where it belongs, made on purpose.
 */

export interface FeatureAlias {
  /** The SDK resource property path. */
  id: string
  /** Top-level CLI command groups for this feature. */
  cli: string[]
  /** Route prefixes this feature owns even where no SDK method calls them (`:p` matches one segment). */
  routePrefixes: string[]
  /** MCP tool files that mostly serve this feature (a label). */
  mcpFiles: string[]
}

export const FEATURE_ALIASES: readonly FeatureAlias[] = [
  { id: "client", cli: [], routePrefixes: ["/v1/me"], mcpFiles: [] },
  { id: "workflows", cli: ["workflows"], routePrefixes: ["/v1/workflows", "/v1/projects/:p/workflows", "/v1/public"], mcpFiles: ["workflows.ts", "render-final.ts", "diagnose.ts"] },
  { id: "workflows.collaborators", cli: [], routePrefixes: ["/v1/workflows/:p/collaborators"], mcpFiles: [] },
  { id: "projects", cli: ["projects"], routePrefixes: ["/v1/projects"], mcpFiles: ["projects.ts"] },
  { id: "jobs", cli: ["jobs"], routePrefixes: ["/v1/jobs"], mcpFiles: ["jobs.ts"] },
  { id: "videoPro", cli: ["video-pro"], routePrefixes: ["/v1/generate-video-pro"], mcpFiles: [] },
  { id: "executions", cli: ["executions"], routePrefixes: ["/v1/workflow-executions", "/v1/executions", "/v1/execution-stats"], mcpFiles: [] },
  { id: "nodes", cli: ["nodes"], routePrefixes: ["/v1/nodes", "/v1/node-defaults"], mcpFiles: [] },
  { id: "scene3d", cli: [], routePrefixes: ["/v1/3d-scene", "/v1/generate-3d-scene", "/v1/edit-3d-scene", "/v1/render-video", "/v1/pro-3d-render"], mcpFiles: ["verbs-scene3d.ts"] },
  { id: "developerApps", cli: [], routePrefixes: ["/v1/developer-apps"], mcpFiles: [] },
  { id: "oauth", cli: [], routePrefixes: ["/v1/oauth"], mcpFiles: [] },
  { id: "apps", cli: ["apps"], routePrefixes: ["/v1/apps", "/v1/app"], mcpFiles: ["apps.ts", "components.ts"] },
  { id: "characters", cli: ["characters"], routePrefixes: ["/v1/characters"], mcpFiles: ["characters.ts"] },
  { id: "locations", cli: ["locations"], routePrefixes: ["/v1/locations"], mcpFiles: ["locations.ts"] },
  { id: "objects", cli: ["objects"], routePrefixes: ["/v1/objects"], mcpFiles: ["objects.ts"] },
  { id: "creatures", cli: [], routePrefixes: ["/v1/creatures"], mcpFiles: ["creatures.ts"] },
  { id: "pipelines", cli: [], routePrefixes: ["/v1/pipelines"], mcpFiles: ["pipelines.ts"] },
  { id: "reduce", cli: [], routePrefixes: ["/v1/reduce"], mcpFiles: ["reduce.ts"] },
  { id: "promptHelper", cli: ["prompt"], routePrefixes: ["/v1/prompt-helper"], mcpFiles: ["prompt-helper.ts"] },
  { id: "voices", cli: ["voice"], routePrefixes: ["/v1/voices", "/v1/voice-clones", "/v1/voice-changer-pro"], mcpFiles: ["voice-changer-pro-engines.ts"] },
  { id: "llm", cli: [], routePrefixes: ["/v1/llm"], mcpFiles: [] },
  { id: "media", cli: ["media"], routePrefixes: ["/v1/media"], mcpFiles: [] },
  { id: "audio", cli: ["audio"], routePrefixes: [], mcpFiles: ["verbs-audio.ts"] },
  { id: "credits", cli: [], routePrefixes: ["/v1/user/credits", "/v1/credits"], mcpFiles: [] },
  { id: "uploads", cli: [], routePrefixes: ["/v1/upload", "/v1/upload-json", "/v1/upload-page", "/v1/upload-proxy"], mcpFiles: ["upload.ts"] },
  { id: "library", cli: [], routePrefixes: ["/v1/library"], mcpFiles: ["gallery.ts"] },
  { id: "presets", cli: ["presets"], routePrefixes: ["/v1/node-presets", "/v1/node-preset-groups"], mcpFiles: ["node-presets.ts"] },
  { id: "savedPosts", cli: ["saved-posts"], routePrefixes: ["/v1/saved-posts"], mcpFiles: ["saved-posts.ts"] },
  { id: "collections", cli: ["collections"], routePrefixes: ["/v1/collections"], mcpFiles: ["collections.ts"] },
  { id: "competitors", cli: ["competitors"], routePrefixes: ["/v1/competitors", "/v1/competitor-scan", "/v1/competitor-discover"], mcpFiles: ["competitors.ts"] },
  { id: "pickerCatalogs", cli: ["pickers"], routePrefixes: ["/v1/picker-catalogs"], mcpFiles: ["picker-catalogs.ts"] },
  { id: "catalogs", cli: ["catalog"], routePrefixes: ["/v1/catalogs"], mcpFiles: [] },
  { id: "models", cli: ["models"], routePrefixes: ["/v1/models"], mcpFiles: ["models.ts"] },
  { id: "shots", cli: ["shots"], routePrefixes: ["/v1/shots"], mcpFiles: ["shot-shapes.ts"] },
  { id: "recast", cli: ["recast"], routePrefixes: ["/v1/recast"], mcpFiles: ["recast.ts"] },
  { id: "studio", cli: [], routePrefixes: ["/v1/studio"], mcpFiles: ["studio-production.ts", "studio-production-run.ts"] },
  { id: "studio.productions", cli: [], routePrefixes: ["/v1/studio/productions"], mcpFiles: ["studio-production.ts", "studio-production-run.ts"] },
  { id: "copilot", cli: [], routePrefixes: ["/v1/copilot"], mcpFiles: [] },
  { id: "community", cli: ["community"], routePrefixes: ["/v1/community"], mcpFiles: [] },
  { id: "templates", cli: [], routePrefixes: ["/v1/templates"], mcpFiles: [] },
  { id: "tutorials", cli: [], routePrefixes: ["/v1/tutorials"], mcpFiles: [] },
  { id: "organizations", cli: ["org"], routePrefixes: ["/v1/organizations", "/v1/orgs", "/v1/invitations"], mcpFiles: [] },
  { id: "workspaces", cli: ["workspace"], routePrefixes: ["/v1/workspaces"], mcpFiles: ["workspaces.ts"] },
  { id: "edit", cli: ["edit"], routePrefixes: ["/v1/edit-plan"], mcpFiles: [] },
]

/** CLI groups that never call the API (credentials on this machine). */
export const LOCAL_CLI_GROUPS: ReadonlySet<string> = new Set(["auth"])

/**
 * Routes served by the Cloud plugin, registered at run time and deliberately
 * absent from this repo: a static scan reports them as `plugin`, not missing.
 * `--runtime` with the plugin installed sees them for real.
 */
export const PLUGIN_ROUTE_PREFIXES: readonly string[] = [
  "/v1/studio/productions",
  "/v1/ugc",
  "/v1/recast",
  "/v1/video-analysis/import",
  "/v1/video-analysis/authoring-skill",
  "/v1/competitors",
  "/v1/competitor-scan",
  "/v1/competitor-discover",
  "/v1/social-search",
  "/v1/voice-changer-pro",
  "/v1/moderate-image",
  "/v1/workflows/:p/collaborators",
  "/v1/telegram-accounts",
  "/v1/content-recipe",
  "/v1/content-ideas",
  "/v1/orgs",
  "/v1/invitations",
  "/v1/workspaces",
]

/**
 * Route first segments that no SDK resource claims, each its own
 * `route:<segment>` feature. Listing one here says "this family is reachable
 * over REST on purpose, without an SDK resource (yet)".
 */
export const ROUTE_ONLY_FAMILIES: Readonly<Record<string, string>> = {
  "ai-writer": "the AI Writer node's routes",
  api: "the original run-a-workflow API (`/v1/api/run`, schema, status, result)",
  "api-tokens": "personal API tokens",
  billing: "the account's plan and billing",
  component: "running a saved component",
  consent: "consent prompts and their answers",
  "deployment-billing": "a deployment's own billing for its users",
  download: "downloading a finished asset",
  "edit-image": "the Edit Image route",
  embed: "embedded apps",
  "extract-youtube-audio": "audio from a YouTube link",
  faces: "saved faces",
  fonts: "the font list",
  "freecut-export": "exporting a cut to an external editor",
  gallery: "the community gallery",
  "generate-face": "the Generate Face route",
  heygen: "HeyGen avatars and voices",
  "image-collage": "the Image Collage route",
  "image-proxy": "proxying a remote image",
  "image-to-image": "the Image to Image route",
  "llm-chat": "the LLM Chat node's routes",
  "llm-suggest-description": "suggesting a description with an LLM",
  "meta-ads-scrape": "the Meta Ads scrape node's routes",
  onboarding: "the onboarding state",
  present: "presentation mode",
  profile: "the user's public profile",
  "prompt-snippets": "saved prompt snippets",
  "shot-sequence": "the Shot Sequence route",
  "site-assets": "assets of captured sites",
  "site-capture": "capturing a website",
  social: "social accounts, publishing and scheduled posts",
  "social-search": "the Social Search node (Cloud plugin)",
  "speaker-frames": "the speaker-frame picker",
  "split-image": "the Split Image route",
  sso: "single sign-on",
  stats: "usage statistics",
  storage: "storage usage",
  suno: "Suno music generation and editing",
  surface: "the deployment's surface profile",
  telegram: "Telegram triggers",
  "telegram-channel": "the Telegram Channel Feed node's routes",
  ugc: "UGC video building (Cloud plugin)",
  user: "per-user settings and earnings",
  "video-analysis": "video analysis",
  "video-audit": "the Video Audit route",
  "video-director": "the Video Director",
  "webhook-output": "the Webhook Output node's route",
  "workflow-triggers": "workflow triggers",
  "youtube-audio": "YouTube audio downloads",
}

/**
 * Node types served by a route that is neither `/v1/<type>` nor in the workflow
 * engine's SYNC_HTTP_ROUTES (the engine dispatches these through a queue, the
 * editor and the MCP tools call the route below). A guard test pins every key
 * to a real node type and every value to a registered POST route.
 */
export const NODE_ROUTE_OVERRIDES: Readonly<Record<string, string>> = {
  "suno-generate": "/v1/suno/generate",
  "suno-cover": "/v1/suno/cover",
  "suno-extend": "/v1/suno/extend",
  "suno-lyrics": "/v1/suno/lyrics",
  "suno-separate": "/v1/suno/separate",
  "suno-music-video": "/v1/suno/music-video",
  "suno-mashup": "/v1/suno/mashup",
  "suno-replace-section": "/v1/suno/replace-section",
  "suno-add-instrumental": "/v1/suno/add-instrumental",
  "suno-add-vocals": "/v1/suno/add-vocals",
  "suno-convert-wav": "/v1/suno/convert-wav",
  "suno-upload-extend": "/v1/suno/upload-extend",
  "suno-voice": "/v1/suno/voice/generate",
}

/** Whether `path` is `prefix` or under it; a `:p` segment of the prefix matches any one segment. */
export function underPrefix(path: string, prefix: string): boolean {
  const a = path.split("/")
  const b = prefix.split("/")
  if (b.length > a.length) return false
  return b.every((seg, i) => seg === a[i] || seg === ":p")
}

/** Whether two normalized paths can name the same route (`:p` matches any one segment). */
export function samePath(a: string, b: string): boolean {
  const x = a.split("/")
  const y = b.split("/")
  return x.length === y.length && x.every((seg, i) => seg === y[i] || seg === ":p" || y[i] === ":p")
}

export function isPluginPath(path: string): boolean {
  return PLUGIN_ROUTE_PREFIXES.some((p) => underPrefix(path, p))
}

/** The alias row owning `path` by the longest matching prefix. */
export function ownerByPrefix(path: string): FeatureAlias | undefined {
  let best: { alias: FeatureAlias; len: number } | undefined
  for (const alias of FEATURE_ALIASES) {
    for (const p of alias.routePrefixes) {
      if (underPrefix(path, p) && (!best || p.length > best.len)) best = { alias, len: p.length }
    }
  }
  return best?.alias
}
