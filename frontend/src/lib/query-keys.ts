export const queryKeys = {
  // Credits
  credits: {
    all: ["credits"] as const,
    balance: (userId: string) => ["credits", "balance", userId] as const,
    modelCost: (model: string) => ["credits", "model-cost", model] as const,
  },

  // Billing
  billing: {
    all: ["billing"] as const,
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
  projects: {
    all: ["projects"] as const,
    list: () => ["projects", "list"] as const,
    detail: (projectId: string) => ["projects", "detail", projectId] as const,
  },

  // Search
  search: {
    all: ["search"] as const,
    results: (query: string) => ["search", query] as const,
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

  // Tutorials
  tutorials: {
    all: ["tutorials"] as const,
  },

  // Admin
  admin: {
    all: ["admin"] as const,
    stats: () => ["admin", "stats"] as const,
    users: (page: number, pageSize: number, sortBy?: string, sortDir?: string) =>
      ["admin", "users", page, pageSize, sortBy ?? "created_at", sortDir ?? "desc"] as const,
    jobs: (page: number, pageSize: number, status?: string, userId?: string) =>
      ["admin", "jobs", page, pageSize, status ?? "", userId ?? ""] as const,
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
    userTransactions: (userId: string) =>
      ["admin", "user-transactions", userId] as const,
    apps: (page: number, pageSize: number) =>
      ["admin", "apps", page, pageSize] as const,
    creditAnomalies: (offset: number, status: string, anomalyType: string, model: string) =>
      ["admin", "credit-anomalies", "list", offset, status, anomalyType, model] as const,
    creditAnomaliesSummary: () =>
      ["admin", "credit-anomalies", "summary"] as const,
    kieCredits: (days: number) =>
      ["admin", "kie-credits", days] as const,
    llmModels: () => ["admin", "llm-models"] as const,
    tutorials: () => ["admin", "tutorials"] as const,
    nodeDefaults: () => ["admin", "node-defaults"] as const,
  },

  nodeDefaults: {
    all: ["node-defaults"] as const,
  },
} as const
