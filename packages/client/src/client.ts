import { WorkflowsResource } from "./resources/workflows.js"
import { ProjectsResource } from "./resources/projects.js"
import { SessionsResource } from "./resources/sessions.js"
import { TrashResource } from "./resources/trash.js"
import { JobsResource } from "./resources/jobs.js"
import { VideoProResource } from "./resources/video-pro.js"
import { ExecutionsResource } from "./resources/executions.js"
import { NodesResource } from "./resources/nodes.js"
import { Scene3DResource } from "./resources/scene3d.js"
import { DeveloperAppsResource } from "./resources/developer-apps.js"
import { OAuthResource } from "./resources/oauth.js"
import { WebhooksResource } from "./resources/webhooks.js"
import { AppsResource } from "./resources/apps.js"
import { CharactersResource } from "./resources/characters.js"
import { LocationsResource } from "./resources/locations.js"
import { ObjectsResource } from "./resources/objects.js"
import { CreaturesResource } from "./resources/creatures.js"
import { KeepersResource } from "./resources/keepers.js"
import { PipelinesResource } from "./resources/pipelines.js"
import { ReduceResource } from "./resources/reduce.js"
import { PromptHelperResource } from "./resources/prompt-helper.js"
import { VoicesResource } from "./resources/voices.js"
import { LlmResource } from "./resources/llm.js"
import { MediaResource } from "./resources/media.js"
import { AudioResource } from "./resources/audio.js"
import { CreditsResource } from "./resources/credits.js"
import { BillingResource } from "./resources/billing.js"
import { UserSettingsResource } from "./resources/user-settings.js"
import { UploadsResource } from "./resources/uploads.js"
import { LibraryResource } from "./resources/library.js"
import { GalleryResource } from "./resources/gallery.js"
import { PresetsResource } from "./resources/node-presets.js"
import { SavedPostsResource } from "./resources/saved-posts.js"
import { CollectionsResource } from "./resources/collections.js"
import { PalettesResource } from "./resources/palettes.js"
import { MoodboardsResource } from "./resources/moodboards.js"
import { CompetitorsResource } from "./resources/competitors.js"
import { PickerCatalogsResource } from "./resources/picker-catalogs.js"
import { CatalogsResource } from "./resources/catalogs.js"
import { ModelsResource } from "./resources/models.js"
import { ShotsResource } from "./resources/shots.js"
import { RecastResource } from "./resources/recast.js"
import { CastSwapResource } from "./resources/cast-swap.js"
import { TrendsResource } from "./resources/trends.js"
import { StudioResource } from "./resources/studio.js"
import { CopilotResource } from "./resources/copilot.js"
import { CommunityResource } from "./resources/community.js"
import { TemplatesResource } from "./resources/templates.js"
import { TutorialsResource } from "./resources/tutorials.js"
import { OrganizationsResource } from "./resources/organizations.js"
import { WorkspacesResource } from "./resources/workspaces.js"
import { EditResource } from "./resources/edit.js"
import { NodaroClientCore, type ClientOptions } from "./core.js"

export { CLIENT_HEADER } from "./core.js"
export type { ClientOptions, UserIdentity, ConnectedApp } from "./core.js"

/**
 * The full client: the core (`./core.ts` — config, transport, identity) and
 * every resource.
 */
export class NodaroClient extends NodaroClientCore {
  readonly workflows: WorkflowsResource
  readonly projects: ProjectsResource
  /** Generation sessions inside projects (Create Image / Video / Music). */
  readonly sessions: SessionsResource
  /** Your Trash: items removed from sessions and deleted jobs. */
  readonly trash: TrashResource
  readonly jobs: JobsResource
  readonly videoPro: VideoProResource
  readonly executions: ExecutionsResource
  readonly nodes: NodesResource
  readonly scene3d: Scene3DResource
  readonly developerApps: DeveloperAppsResource
  readonly oauth: OAuthResource
  /** Outbound webhooks: endpoints that receive your job.completed / job.failed. */
  readonly webhooks: WebhooksResource
  readonly apps: AppsResource
  readonly characters: CharactersResource
  readonly locations: LocationsResource
  readonly objects: ObjectsResource
  readonly creatures: CreaturesResource
  /** The shared Nodaro Keepers catalog of characters, creatures, locations and objects. */
  readonly keepers: KeepersResource
  readonly pipelines: PipelinesResource
  readonly reduce: ReduceResource
  readonly promptHelper: PromptHelperResource
  readonly voices: VoicesResource
  readonly llm: LlmResource
  readonly media: MediaResource
  readonly audio: AudioResource
  readonly credits: CreditsResource
  /** The signed-in person's own settings (the interface language, the monthly statement opt-in, …). */
  readonly userSettings: UserSettingsResource
  /** Plans and prices, the subscription, and how this deployment bills. */
  readonly billing: BillingResource
  readonly uploads: UploadsResource
  readonly library: LibraryResource
  /** The public gallery and your favorites. */
  readonly gallery: GalleryResource
  readonly presets: PresetsResource
  readonly savedPosts: SavedPostsResource
  readonly collections: CollectionsResource
  /** Your colour palettes — a generate-image direction (`direction.colorLook: paletteDirectionId(id)`). */
  readonly palettes: PalettesResource
  /** Your moodboards — a generate-image direction (`direction.style: moodboardDirectionId(id)`). */
  readonly moodboards: MoodboardsResource
  readonly competitors: CompetitorsResource
  readonly pickerCatalogs: PickerCatalogsResource
  readonly catalogs: CatalogsResource
  readonly models: ModelsResource
  readonly shots: ShotsResource
  readonly recast: RecastResource
  /** Cast Swap: replace the people and/or location in a short video (Cloud). */
  readonly castSwap: CastSwapResource
  /** Trends: ready-made Cast Swap recipes you fill with your own pictures (Cloud). */
  readonly trends: TrendsResource
  readonly studio: StudioResource
  readonly copilot: CopilotResource
  readonly community: CommunityResource
  readonly templates: TemplatesResource
  readonly tutorials: TutorialsResource
  readonly organizations: OrganizationsResource
  readonly workspaces: WorkspacesResource
  readonly edit: EditResource

  constructor(opts: ClientOptions) {
    super(opts)

    this.workflows = new WorkflowsResource(this)
    this.projects = new ProjectsResource(this)
    this.sessions = new SessionsResource(this)
    this.trash = new TrashResource(this)
    this.jobs = new JobsResource(this)
    this.videoPro = new VideoProResource(this)
    this.executions = new ExecutionsResource(this)
    this.nodes = new NodesResource(this)
    this.scene3d = new Scene3DResource(this)
    this.developerApps = new DeveloperAppsResource(this)
    this.oauth = new OAuthResource(this)
    this.webhooks = new WebhooksResource(this)
    this.apps = new AppsResource(this)
    this.characters = new CharactersResource(this)
    this.locations = new LocationsResource(this)
    this.objects = new ObjectsResource(this)
    this.creatures = new CreaturesResource(this)
    this.keepers = new KeepersResource(this)
    this.pipelines = new PipelinesResource(this)
    this.reduce = new ReduceResource(this)
    this.promptHelper = new PromptHelperResource(this)
    this.voices = new VoicesResource(this)
    this.llm = new LlmResource(this)
    this.media = new MediaResource(this)
    this.audio = new AudioResource(this)
    this.credits = new CreditsResource(this)
    this.userSettings = new UserSettingsResource(this)
    this.billing = new BillingResource(this)
    this.uploads = new UploadsResource(this)
    this.library = new LibraryResource(this)
    this.gallery = new GalleryResource(this)
    this.presets = new PresetsResource(this)
    this.savedPosts = new SavedPostsResource(this)
    this.collections = new CollectionsResource(this)
    this.palettes = new PalettesResource(this)
    this.moodboards = new MoodboardsResource(this)
    this.competitors = new CompetitorsResource(this)
    this.pickerCatalogs = new PickerCatalogsResource(this)
    this.catalogs = new CatalogsResource(this)
    this.models = new ModelsResource(this)
    this.shots = new ShotsResource(this)
    this.recast = new RecastResource(this)
    this.castSwap = new CastSwapResource(this)
    this.trends = new TrendsResource(this)
    this.studio = new StudioResource(this)
    this.copilot = new CopilotResource(this)
    this.community = new CommunityResource(this)
    this.templates = new TemplatesResource(this)
    this.tutorials = new TutorialsResource(this)
    this.organizations = new OrganizationsResource(this)
    this.workspaces = new WorkspacesResource(this)
    this.edit = new EditResource(this)
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
    // The two private settings are read by bracket access, which TypeScript
    // allows on a subclass and which adds no member to the declarations. Read
    // through `this` (not a side table keyed by the instance), so a client
    // wrapped in a Proxy (Vue/Pinia `reactive()`) or reached through
    // `Object.create(client)` still works.
    const fetchOverride = this["fetchOverride"]
    return new NodaroClient({
      baseUrl: this.baseUrl,
      auth: this.auth,
      timeoutMs: this.timeoutMs,
      ...(fetchOverride ? { fetch: fetchOverride } : {}),
      ...(this["sendClientHeader"] ? { clientLabel: this.clientLabel } : {}),
      ...(workspaceId ? { workspaceId } : {}),
    })
  }
}

/** Factory function — preferred entry point. */
export function createClient(opts: ClientOptions): NodaroClient {
  return new NodaroClient(opts)
}
