export const queryKeys = {
  // Workflow Copilot (Cloud only)
  copilot: {
    all: ["copilot"] as const,
    thread: (threadId: string) => ["copilot", "thread", threadId] as const,
    forWorkflow: (workflowId: string) => ["copilot", "for-workflow", workflowId] as const,
  },

  // Credits
  credits: {
    all: ["credits"] as const,
    balance: (userId: string) => ["credits", "balance", userId] as const,
    modelCost: (model: string) => ["credits", "model-cost", model] as const,
  },

  // Billing
  billing: {
    all: ["billing"] as const,
    // Per-user account summary. Scoped by userId so a same-browser account
    // switch (no page reload) never serves user A's cached account to user B.
    account: (userId: string) => ["billing", "account", userId] as const,
    subscription: (userId: string) => ["billing", "subscription", userId] as const,
    transactions: (userId: string) => ["billing", "transactions", userId] as const,
    storage: (userId: string) => ["billing", "storage", userId] as const,
  },

  // Stats
  stats: {
    all: ["stats"] as const,
    scoped: (scope: "user" | "platform", userId: string) =>
      ["stats", scope, userId] as const,
  },

  // User settings
  userSettings: {
    all: ["user-settings"] as const,
    detail: (userId: string) => ["user-settings", userId] as const,
  },

  // Node presets
  nodePresets: {
    all: ["nodePresets"] as const,
    list: (nodeType?: string) => ["nodePresets", "list", nodeType ?? ""] as const,
  },

  // Node preset favorites (per-user starred presets, keyed by node type)
  nodePresetFavorites: {
    all: ["nodePresetFavorites"] as const,
    list: (nodeType?: string) => ["nodePresetFavorites", "list", nodeType ?? ""] as const,
  },

  // Node preset groups (folders / sections)
  nodePresetGroups: {
    all: ["nodePresetGroups"] as const,
    list: (nodeType?: string) => ["nodePresetGroups", "list", nodeType ?? ""] as const,
  },

  // Prompt snippets (one global per-user pool — scoping is by media/target, not node type)
  promptSnippets: {
    all: ["promptSnippets"] as const,
    list: () => ["promptSnippets", "list"] as const,
  },

  // App settings (admin)
  appSettings: {
    all: ["app-settings"] as const,
  },

  // App Marketplace
  appMarketplace: {
    all: ["app-marketplace"] as const,
    browse: (filter: string) => ["app-marketplace", "browse", filter] as const,
    favorites: (userId: string) => ["app-marketplace", "favorites", userId] as const,
  },

  // Template Marketplace
  templateMarketplace: {
    all: ["template-marketplace"] as const,
    browse: (filter: string) => ["template-marketplace", "browse", filter] as const,
    favorites: (userId: string) => ["template-marketplace", "favorites", userId] as const,
    detail: (slug: string) => ["template-marketplace", "detail", slug] as const,
  },

  // Gallery
  gallery: {
    all: ["gallery"] as const,
    list: (filter: string) => ["gallery", "list", filter] as const,
    favorites: (userId: string) => ["gallery", "favorites", userId] as const,
    reportCount: () => ["gallery", "report-count"] as const,
  },

  // Assets
  assets: {
    all: ["assets"] as const,
    characters: (projectId?: string, userId?: string) =>
      ["assets", "characters", projectId ?? "", userId ?? ""] as const,
    objects: (projectId?: string, userId?: string) =>
      ["assets", "objects", projectId ?? "", userId ?? ""] as const,
    creatures: (projectId?: string, userId?: string) =>
      ["assets", "creatures", projectId ?? "", userId ?? ""] as const,
    locations: (projectId?: string, userId?: string) =>
      ["assets", "locations", projectId ?? "", userId ?? ""] as const,
    faces: (projectId?: string, userId?: string) =>
      ["assets", "faces", projectId ?? "", userId ?? ""] as const,
  },

  // Library (media)
  library: {
    all: ["library"] as const,
    list: (params: { userId: string; type?: string; search?: string; owned?: boolean }) =>
      ["library", "list", params.userId, params.type ?? "", params.search ?? "", String(params.owned ?? false)] as const,
  },

  // Editor / workflow
  editor: {
    all: ["editor"] as const,
    costSummary: (jobIds: readonly string[]) =>
      ["editor", "cost-summary", [...jobIds].sort()] as const,
    importableWorkflows: (projectId: string, currentWorkflowId: string) =>
      ["editor", "importable-workflows", projectId, currentWorkflowId] as const,
  },

  // Jobs
  jobs: {
    all: ["jobs"] as const,
    list: (userId: string, cursor?: string) =>
      ["jobs", "list", userId, cursor] as const,
    detail: (jobId: string) => ["jobs", "detail", jobId] as const,
  },

  // Projects
  // `workspaceId` is a REQUIRED first argument on every list below, and there
  // is deliberately no default.
  //
  // These are the only two tables whose rows differ by workspace, so they are
  // the only keys that carry one — assets, characters, locations and the rest
  // have no workspace column at all and never have, so keying them would
  // duplicate a cache that cannot differ.
  //
  // Required, because the value has to reach the FILTER as well, and both must
  // come from the same render. A default would let a call site take the key
  // without the filter and cache one workspace's rows under another's name;
  // making it mandatory turns that mistake into a compile error, and the
  // compiler then lists every site that has to be looked at.
  projects: {
    all: ["projects"] as const,
    list: (workspaceId: string | null) => ["projects", "list", workspaceId ?? "personal"] as const,
    detail: (projectId: string) => ["projects", "detail", projectId] as const,
  },

  // Workflows (flat, owner-scoped)
  workflows: {
    all: ["workflows"] as const,
    listMine: (workspaceId: string | null) =>
      ["workflows", "list", "mine", workspaceId ?? "personal"] as const,
    listStudioMine: (workspaceId: string | null) =>
      ["workflows", "list", "studio", "mine", workspaceId ?? "personal"] as const,
    // NOT keyed by workspace, deliberately: this is the admin cross-user
    // view, and the route answers it identically whatever the header says —
    // its branch returns before any scoping runs. Keying it would split a
    // cache that cannot differ and refetch on every switch for nothing.
    listStudioAll: () => ["workflows", "list", "studio", "all"] as const,
  },

  // Client-app registry (which SDK apps exist, whose workflows are user-facing).
  // Tiny + near-immutable — cached hard; see use-client-apps-queries.ts.
  clientApps: {
    all: ["client-apps"] as const,
    list: () => ["client-apps", "list"] as const,
  },

  // Search
  // The workspace belongs here for the same reason it belongs on the lists:
  // this search FILTERS by it. Keyed by the text alone, searching the same
  // word in a second class served the first one0s results out of cache — the
  // exact "entry labelled one workspace, holding another0s rows" the scope
  // hook exists to prevent, created in the file that warns about it.
  search: {
    all: ["search"] as const,
    results: (query: string, workspaceId: string | null) =>
      ["search", query, workspaceId ?? "personal"] as const,
  },

  // Voices
  voices: {
    all: ["voices"] as const,
    list: () => ["voices", "list"] as const,
    library: (params: Record<string, string | undefined>) => ["voices", "library", params] as const,
    clones: () => ["voices", "clones"] as const,
  },

  // Executions (global)
  executions: {
    all: ["executions"] as const,
    list: (params: { status?: string; viewAll?: boolean; cursor?: string }) =>
      ["executions", "list", params.status ?? "", String(params.viewAll ?? false), params.cursor ?? ""] as const,
  },

  // API Tokens
  apiTokens: {
    all: ["api-tokens"] as const,
    list: () => ["api-tokens", "list"] as const,
  },

  // Developer Apps (OAuth)
  developerApps: {
    all: ["developer-apps"] as const,
    list: () => ["developer-apps", "list"] as const,
    detail: (id: string) => ["developer-apps", "detail", id] as const,
  },

  // Tutorials (public, grouped video + flow)
  tutorials: {
    all: ["tutorials"] as const,
    grouped: () => ["tutorials", "grouped"] as const,
  },

  // Admin
  admin: {
    all: ["admin"] as const,
    stats: () => ["admin", "stats"] as const,
    users: (page: number, pageSize: number, sortBy?: string, sortDir?: string) =>
      ["admin", "users", page, pageSize, sortBy ?? "created_at", sortDir ?? "desc"] as const,
    jobs: (
      page: number,
      pageSize: number,
      status?: string,
      userId?: string,
      excludeUserIds?: ReadonlyArray<string>,
    ) =>
      [
        "admin",
        "jobs",
        page,
        pageSize,
        status ?? "",
        userId ?? "",
        [...(excludeUserIds ?? [])].sort().join(","),
      ] as const,
    // Infinite (Gallery view) counterpart of `jobs` — page is managed inside
    // useInfiniteQuery, so it is not part of the key.
    jobsInfinite: (
      pageSize: number,
      status?: string,
      userId?: string,
      excludeUserIds?: ReadonlyArray<string>,
    ) =>
      [
        "admin",
        "jobs-infinite",
        pageSize,
        status ?? "",
        userId ?? "",
        [...(excludeUserIds ?? [])].sort().join(","),
      ] as const,
    usersLite: () => ["admin", "users-lite"] as const,
    usageLogs: (
      page: number,
      pageSize: number,
      groupBy?: string,
      sortBy?: string,
      sortDir?: string,
    ) =>
      [
        "admin",
        "usage-logs",
        page,
        pageSize,
        groupBy ?? "none",
        sortBy ?? "created_at",
        sortDir ?? "desc",
      ] as const,
    models: () => ["admin", "models"] as const,
    reports: (page: number, status?: string) =>
      ["admin", "reports", page, status ?? ""] as const,
    alerts: () => ["admin", "alerts"] as const,
    settings: () => ["admin", "settings"] as const,
    messageTemplates: () => ["admin", "message-templates"] as const,
    userMessages: (userId: string) =>
      ["admin", "user-messages", userId] as const,
    userTransactions: (userId: string) =>
      ["admin", "user-transactions", userId] as const,
    userSubscription: (userId: string) =>
      ["admin", "user-subscription", userId] as const,
    apps: (page: number, pageSize: number) =>
      ["admin", "apps", page, pageSize] as const,
    creditAnomalies: (offset: number, status: string, anomalyType: string, model: string) =>
      ["admin", "credit-anomalies", "list", offset, status, anomalyType, model] as const,
    creditAnomaliesSummary: () =>
      ["admin", "credit-anomalies", "summary"] as const,
    pickerGaps: (offset: number, picker: string, gapType: string, status: string) =>
      ["admin", "picker-gaps", "list", offset, picker, gapType, status] as const,
    appReports: (offset: number, kind: string, appSlug: string, status: string, userFilter: string) =>
      ["admin", "app-reports", "list", offset, kind, appSlug, status, userFilter] as const,
    kieCredits: (days: number) =>
      ["admin", "kie-credits", days] as const,
    copilotGapsOverview: (days: number) =>
      ["admin", "copilot-gaps", "overview", days] as const,
    copilotGapsDay: (day: string) =>
      ["admin", "copilot-gaps", "day", day] as const,
    llmModels: () => ["admin", "llm-models"] as const,
    tutorials: () => ["admin", "tutorials"] as const,
    tutorialCategories: () => ["admin", "tutorial-categories"] as const,
    workflowTemplatesAll: (params: { search?: string; listed?: string; cursor?: string }) =>
      [
        "admin",
        "workflow-templates",
        params.search ?? "",
        params.listed ?? "",
        params.cursor ?? "",
      ] as const,
    nodeDefaults: () => ["admin", "node-defaults"] as const,
    clientApps: () => ["admin", "client-apps"] as const,
  },

  nodeDefaults: {
    all: ["node-defaults"] as const,
  },

  archivedRuns: {
    all: ["archived-runs"] as const,
    list: (cursor?: string) => (cursor ? ["archived-runs", "list", cursor] as const : ["archived-runs", "list"] as const),
  },

  /**
   * Organizations. Everything hangs off `all` so one invalidation after a
   * membership change refreshes every view that could have been affected by
   * it — a role change alters what its subject may see in several places at
   * once, and reasoning about which is how a stale roster survives.
   */
  orgs: {
    all: ["orgs"] as const,
    list: () => ["orgs", "list"] as const,
    detail: (orgId: string) => ["orgs", "detail", orgId] as const,
    members: (orgId: string, cursor?: string) =>
      cursor ? (["orgs", "members", orgId, cursor] as const) : (["orgs", "members", orgId] as const),
    invitations: (orgId: string, status?: string, workspaceId?: string) =>
      ["orgs", "invitations", orgId, status ?? "", workspaceId ?? ""] as const,
    workspaces: (orgId: string, includeArchived?: boolean) =>
      ["orgs", "workspaces", orgId, includeArchived ? "with-archived" : "live"] as const,
    audit: (orgId: string, cursor?: string) =>
      cursor ? (["orgs", "audit", orgId, cursor] as const) : (["orgs", "audit", orgId] as const),
    // P15 usage reports. scope-key-ok: object-addressed report; the id in the
    // path is the scope, so these are not filtered by useWorkspaceScope().
    usage: (orgId: string, params: Record<string, string | number | undefined>) =>
      ["orgs", "usage", orgId, params] as const,
    usageRows: (orgId: string, params: Record<string, string | number | undefined>, cursor?: string) =>
      ["orgs", "usage-rows", orgId, params, cursor ?? ""] as const,
    workspaceUsage: (workspaceId: string, params: Record<string, string | number | undefined>) =>
      ["orgs", "workspace-usage", workspaceId, params] as const,
    workspaceUsageRows: (workspaceId: string, params: Record<string, string | number | undefined>, cursor?: string) =>
      ["orgs", "workspace-usage-rows", workspaceId, params, cursor ?? ""] as const,
    workspace: (workspaceId: string) => ["orgs", "workspace", workspaceId] as const,
    workspaceMembers: (workspaceId: string, cursor?: string) =>
      cursor
        ? (["orgs", "workspace-members", workspaceId, cursor] as const)
        : (["orgs", "workspace-members", workspaceId] as const),
    joinCode: (workspaceId: string) => ["orgs", "join-code", workspaceId] as const,
    invitationPreview: (token: string) => ["orgs", "invitation-preview", token] as const,
  },
} as const
