# React Query Migration Guide

> **Status:** Pre-migration
> **Target:** Migrate ~50 manual `useEffect` + `useState` fetch patterns to `@tanstack/react-query`
> **Stack:** Vite + React 19 + React Router DOM 7 + Zustand 5

---

## Table of Contents

1. [Infrastructure Setup](#1-infrastructure-setup)
2. [New Hook Files](#2-new-hook-files)
3. [Per-Site Migration Instructions](#3-per-site-migration-instructions)
4. [Special Patterns](#4-special-patterns)
5. [Cleanup Checklist](#5-cleanup-checklist)
6. [staleTime / gcTime Reference & Verification](#6-staletime--gctime-reference--verification)

---

## 1. Infrastructure Setup

### 1.1 Install packages

```bash
cd frontend
bun add @tanstack/react-query @tanstack/react-query-devtools
```

### 1.2 Create `frontend/src/lib/query-client.ts`

```ts
import { QueryClient } from "@tanstack/react-query"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,        // 1 minute
      gcTime: 5 * 60_000,       // 5 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
```

### 1.3 Create `frontend/src/lib/query-keys.ts`

```ts
// Centralized query key factory — all keys are type-safe tuples.
// Convention: each domain exposes a sub-object with `all`, `list`, `detail` etc.

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

  // Gallery
  gallery: {
    all: ["gallery"] as const,
    list: (filter: string) => ["gallery", "list", filter] as const,
    reportCount: () => ["gallery", "report-count"] as const,
  },

  // Assets
  assets: {
    all: ["assets"] as const,
    characters: (projectId?: string, userId?: string) =>
      ["assets", "characters", { projectId, userId }] as const,
    objects: (projectId?: string, userId?: string) =>
      ["assets", "objects", { projectId, userId }] as const,
    locations: (projectId?: string, userId?: string) =>
      ["assets", "locations", { projectId, userId }] as const,
    faces: (projectId?: string, userId?: string) =>
      ["assets", "faces", { projectId, userId }] as const,
  },

  // Library (media)
  library: {
    all: ["library"] as const,
    list: (params: { userId: string; type?: string; search?: string; owned?: boolean }) =>
      ["library", "list", params] as const,
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

  // Admin
  admin: {
    all: ["admin"] as const,
    stats: () => ["admin", "stats"] as const,
    users: (page: number, pageSize: number) =>
      ["admin", "users", { page, pageSize }] as const,
    jobs: (page: number, pageSize: number, status?: string) =>
      ["admin", "jobs", { page, pageSize, status }] as const,
    usageLogs: (page: number, pageSize: number) =>
      ["admin", "usage-logs", { page, pageSize }] as const,
    models: () => ["admin", "models"] as const,
    reports: (page: number, status?: string) =>
      ["admin", "reports", { page, status }] as const,
    alerts: () => ["admin", "alerts"] as const,
    settings: () => ["admin", "settings"] as const,
    userTransactions: (userId: string) =>
      ["admin", "user-transactions", userId] as const,
  },
} as const
```

### 1.4 Modify `frontend/src/main.tsx`

```tsx
import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import "./globals.css"

import { StrictMode, lazy, Suspense } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router-dom"
import { QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "sonner"
import { queryClient } from "@/lib/query-client"
import { router } from "./router"

// Lazy-load devtools to avoid ~90KB in production bundle
const ReactQueryDevtools = lazy(() =>
  import("@tanstack/react-query-devtools").then((m) => ({
    default: m.ReactQueryDevtools,
  }))
)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
        <Toaster richColors position="bottom-right" />
      </ThemeProvider>
      {import.meta.env.DEV && (
        <Suspense fallback={null}>
          <ReactQueryDevtools initialIsOpen={false} />
        </Suspense>
      )}
    </QueryClientProvider>
  </StrictMode>,
)
```

---

## 2. New Hook Files

Create all files under `frontend/src/hooks/queries/`. Each file exports React Query hooks for one domain.

### 2.1 `hooks/queries/use-credits-queries.ts`

```ts
import { useQuery } from "@tanstack/react-query"
import { getUserCredits, getModelCreditCost, type UserBalance } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

export function useUserCredits(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.credits.balance(userId ?? ""),
    queryFn: async () => {
      const result = await getUserCredits(userId!)
      const data = result.data ?? (result as unknown as UserBalance)
      return data
    },
    enabled: !!userId && hasCredits(),
    refetchInterval: 30_000,
    staleTime: 10_000,
  })
}

export function useModelCreditCost(model: string | undefined) {
  return useQuery({
    queryKey: queryKeys.credits.modelCost(model ?? ""),
    queryFn: async () => {
      const { data } = await getModelCreditCost(model!)
      return data.creditCost
    },
    enabled: !!model && hasCredits(),
    staleTime: Infinity,    // model costs rarely change at runtime
    gcTime: 30 * 60_000,   // keep 30 min
  })
}

/**
 * Synchronous read of cached credit cost (for non-hook contexts).
 * Uses the module-level queryClient singleton — no need to pass it as an argument.
 * Returns undefined if not yet fetched.
 */
export function getCachedCredits(model: string): number | undefined {
  return queryClient.getQueryData<number>(queryKeys.credits.modelCost(model))
}

/**
 * Pre-fetch credit costs for multiple models.
 * Uses the module-level queryClient singleton.
 */
export async function prefetchModelCredits(models: string[]): Promise<void> {
  if (!hasCredits()) return
  await Promise.allSettled(
    models.map((model) =>
      queryClient.prefetchQuery({
        queryKey: queryKeys.credits.modelCost(model),
        queryFn: async () => {
          const { data } = await getModelCreditCost(model)
          return data.creditCost
        },
        staleTime: Infinity,
      }),
    ),
  )
}
```

### 2.2 `hooks/queries/use-billing-queries.ts`

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  getSubscription,
  getTransactions,
  getManageSubscriptionUrl,
  changePlan,
  type SubscriptionInfo,
  type TransactionRecord,
} from "@/lib/api"
import { createClient } from "@/lib/supabase"
import { hasCredits } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"

export function useSubscription(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.billing.subscription(userId ?? ""),
    queryFn: () => getSubscription(userId!),
    enabled: !!userId && hasCredits(),
    staleTime: 60_000,
  })
}

export function useTransactions(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.billing.transactions(userId ?? ""),
    queryFn: () => getTransactions(userId!),
    enabled: !!userId && hasCredits(),
    staleTime: 60_000,
  })
}

export function useStorageProfile(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.billing.storage(userId ?? ""),
    queryFn: async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from("profiles")
        .select("storage_used_bytes, storage_limit_bytes")
        .eq("id", userId!)
        .single()
      return {
        storageUsed: (data?.storage_used_bytes as number) ?? 0,
        storageLimit: (data?.storage_limit_bytes as number) ?? 0,
      }
    },
    enabled: !!userId && hasCredits(),
    staleTime: 30_000,
  })
}

export function useManageSubscriptionMutation() {
  return useMutation({
    mutationFn: (userId: string) => getManageSubscriptionUrl(userId),
  })
}

export function useChangePlanMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, priceId }: { userId: string; priceId: string }) =>
      changePlan(userId, priceId),
    onSuccess: (_data, { userId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.billing.subscription(userId) })
      qc.invalidateQueries({ queryKey: queryKeys.credits.balance(userId) })
    },
  })
}
```

### 2.3 `hooks/queries/use-stats-queries.ts`

```ts
import { useQuery } from "@tanstack/react-query"
import { getStats, type StatsResponse } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"

export function useStats(
  scope: "user" | "platform",
  userId: string | undefined,
  options?: { refetchInterval?: number },
) {
  return useQuery({
    queryKey: queryKeys.stats.scoped(scope, userId ?? ""),
    queryFn: async () => {
      const { data } = await getStats(scope, userId)
      return data
    },
    enabled: !!userId,
    staleTime: 10_000,
    refetchInterval: options?.refetchInterval,
  })
}
```

### 2.4 `hooks/queries/use-user-settings-queries.ts`

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"

interface UserSettings {
  publicOutputs: boolean
  tier: string
  promptTemplates: Record<string, string>
}

async function fetchUserSettings(userId: string): Promise<UserSettings> {
  const res = await fetch(`/v1/user/settings?userId=${encodeURIComponent(userId)}`)
  if (!res.ok) throw new Error("Failed to fetch user settings")
  const json = await res.json()
  const data = json.data ?? json
  return {
    publicOutputs: data.publicOutputs ?? true,
    tier: data.tier ?? "free",
    promptTemplates: data.promptTemplates ?? {},
  }
}

export function useUserSettings(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.userSettings.detail(userId ?? ""),
    queryFn: () => fetchUserSettings(userId!),
    enabled: !!userId,
    staleTime: 60_000,
  })
}

export function useUpdatePublicOutputsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, publicOutputs }: { userId: string; publicOutputs: boolean }) => {
      const res = await fetch(`/v1/user/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, publicOutputs }),
      })
      if (!res.ok) throw new Error("Failed to update settings")
      return res.json()
    },
    onSuccess: (_data, { userId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.userSettings.detail(userId) })
    },
  })
}

export function useSaveTemplatesMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, promptTemplates }: { userId: string; promptTemplates: Record<string, string> }) => {
      const res = await fetch(`/v1/user/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, promptTemplates }),
      })
      if (!res.ok) throw new Error("Failed to save templates")
      return res.json()
    },
    onSuccess: (_data, { userId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.userSettings.detail(userId) })
    },
  })
}
```

### 2.5 `hooks/queries/use-app-settings-queries.ts`

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { isCommunity } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"

export interface AppSettings {
  readonly ai_provider: "replicate" | "kie"
  readonly cost_markup_percent: number
}

const DEFAULT_SETTINGS: AppSettings = {
  ai_provider: "replicate",
  ***REDACTED-OSS-SCRUB***
}

async function fetchAppSettings(): Promise<AppSettings> {
  if (isCommunity()) return DEFAULT_SETTINGS
  const res = await fetch(`/v1/admin/settings`)
  if (!res.ok) return DEFAULT_SETTINGS
  const data = await res.json()
  const settings = data.settings as Record<string, unknown>
  return {
    ai_provider: (settings.ai_provider as "replicate" | "kie") ?? "replicate",
    cost_markup_percent: (settings.cost_markup_percent as number) ?? 25,
  }
}

export function useAppSettings() {
  return useQuery({
    queryKey: queryKeys.appSettings.all,
    queryFn: fetchAppSettings,
    staleTime: 5 * 60_000,   // settings rarely change
    gcTime: 30 * 60_000,
    placeholderData: DEFAULT_SETTINGS,
  })
}

export function useIsKieProvider(): boolean {
  const { data } = useAppSettings()
  return data?.ai_provider === "kie"
}

export function useUpdateSettingMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) => {
      const res = await fetch(`/v1/admin/settings/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      })
      if (!res.ok) throw new Error("Failed to update setting")
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.appSettings.all })
    },
  })
}
```

### 2.6 `hooks/queries/use-gallery-queries.ts`

```ts
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/hooks/use-auth"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"

interface GalleryItem {
  id: string
  type: string
  outputUrl: string
  thumbnailUrl?: string
  model?: string
  inputData?: Record<string, unknown>
  referenceUrls?: string[]
  created_at: string
}

export function useGalleryInfinite(filter: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.gallery.list(filter),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "20" })
      if (filter && filter !== "all") params.set("type", filter)
      if (pageParam) params.set("cursor", pageParam)
      const res = await fetch(`/v1/gallery?${params.toString()}`)
      if (!res.ok) throw new Error("Failed to fetch gallery")
      return res.json() as Promise<{ data: GalleryItem[]; nextCursor: string | null }>
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  })
}

export function useGalleryReportCount() {
  const { user, isAdmin } = useAuth()
  return useQuery({
    queryKey: queryKeys.gallery.reportCount(),
    queryFn: async () => {
      const res = await fetch(
        `/v1/admin/gallery-reports/count?userId=${encodeURIComponent(user!.id)}`,
      )
      if (!res.ok) return 0
      const json = await res.json()
      return (json.data?.count ?? json.count ?? 0) as number
    },
    enabled: !!user?.id && isAdmin && hasAdmin(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

export function useReportGalleryItemMutation() {
  return useMutation({
    mutationFn: async ({ jobId, reason }: { jobId: string; reason: string }) => {
      const res = await fetch(`/v1/gallery/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, reason }),
      })
      if (!res.ok) throw new Error("Failed to report item")
      return res.json()
    },
  })
}

export function useDeleteGalleryItemMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (reportId: string) => {
      const res = await fetch(`/v1/admin/gallery-reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove" }),
      })
      if (!res.ok) throw new Error("Failed to remove item")
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.gallery.all })
    },
  })
}
```

### 2.7 `hooks/queries/use-assets-queries.ts`

```ts
import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import {
  getCharacters,
  getObjects,
  getLocations,
  getFaces,
  getLibraryAssets,
  deleteLibraryAsset,
  type LibraryAsset,
} from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"

// --- Characters ---
export function useCharacters(projectId?: string, userId?: string) {
  return useQuery({
    queryKey: queryKeys.assets.characters(projectId, userId),
    queryFn: () => getCharacters(projectId, userId),
    enabled: !!userId,
    staleTime: 60_000,
    select: (data) => data.characters,
  })
}

// --- Objects ---
export function useObjects(projectId?: string, userId?: string) {
  return useQuery({
    queryKey: queryKeys.assets.objects(projectId, userId),
    queryFn: () => getObjects(projectId, userId),
    enabled: !!userId,
    staleTime: 60_000,
    select: (data) => data.objects,
  })
}

// --- Locations ---
export function useLocations(projectId?: string, userId?: string) {
  return useQuery({
    queryKey: queryKeys.assets.locations(projectId, userId),
    queryFn: () => getLocations(projectId, userId),
    enabled: !!userId,
    staleTime: 60_000,
    select: (data) => data.locations,
  })
}

// --- Faces ---
export function useFaces(projectId?: string, userId?: string) {
  return useQuery({
    queryKey: queryKeys.assets.faces(projectId, userId),
    queryFn: () => getFaces(projectId, userId),
    enabled: !!userId,
    staleTime: 60_000,
    select: (data) => data.faces,
  })
}

// --- Library (paginated) ---
export function useLibraryInfinite(params: {
  userId: string | undefined
  type?: string
  search?: string
  owned?: boolean
  limit?: number
}) {
  const { userId, type, search, owned, limit = 40 } = params
  return useInfiniteQuery({
    queryKey: queryKeys.library.list({
      userId: userId ?? "",
      type,
      search,
      owned,
    }),
    queryFn: async ({ pageParam }) => {
      return getLibraryAssets({
        userId: userId!,
        type: type && type !== "all" ? type : undefined,
        search,
        limit,
        cursor: pageParam,
        owned,
      })
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!userId,
    staleTime: 30_000,
  })
}

export function useDeleteLibraryAssetMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ assetId, userId }: { assetId: string; userId: string }) =>
      deleteLibraryAsset(assetId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.library.all })
      // Also invalidate storage since deletion frees space
      qc.invalidateQueries({ queryKey: queryKeys.billing.all })
    },
  })
}
```

### 2.8 `hooks/queries/use-editor-queries.ts`

```ts
import { useQuery } from "@tanstack/react-query"
import { getWorkflowCostSummary } from "@/lib/api"
import { createClient } from "@/lib/supabase"
import { hasCredits } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"

export function useWorkflowCostSummary(jobIds: readonly string[]) {
  return useQuery({
    queryKey: queryKeys.editor.costSummary(jobIds),
    queryFn: async () => {
      const { data } = await getWorkflowCostSummary(jobIds)
      return data
    },
    enabled: jobIds.length > 0 && hasCredits(),
    staleTime: 60_000,
  })
}

export function useImportableWorkflows(
  projectId: string | undefined,
  currentWorkflowId: string | undefined,
  isOpen: boolean,
) {
  return useQuery({
    queryKey: queryKeys.editor.importableWorkflows(
      projectId ?? "",
      currentWorkflowId ?? "",
    ),
    queryFn: async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("workflows")
        .select("id, name, nodes")
        .eq("project_id", projectId!)
        .neq("id", currentWorkflowId!)
        .order("updated_at", { ascending: false })

      if (error) throw error
      return data ?? []
    },
    enabled: isOpen && !!projectId && !!currentWorkflowId,
    staleTime: 30_000,
  })
}
```

### 2.9 `hooks/queries/use-projects-queries.ts`

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase"
import { queryKeys } from "@/lib/query-keys"

export interface Project {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface Folder {
  readonly id: string
  readonly projectId: string
  readonly name: string
  readonly createdAt: string
}

export interface WorkflowMeta {
  readonly id: string
  readonly projectId: string
  readonly folderId: string | null
  readonly name: string
  readonly createdAt: string
  readonly updatedAt: string
}

function toProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? "",
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function toFolder(row: Record<string, unknown>): Folder {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    name: row.name as string,
    createdAt: row.created_at as string,
  }
}

function toWorkflowMeta(row: Record<string, unknown>): WorkflowMeta {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    folderId: (row.folder_id as string) ?? null,
    name: row.name as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects.list(),
    queryFn: async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false })
      if (error) throw error
      return data.map(toProject)
    },
    staleTime: 30_000,
  })
}

export function useProjectData(projectId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.projects.detail(projectId ?? ""),
    queryFn: async () => {
      const supabase = createClient()
      const [foldersRes, workflowsRes] = await Promise.all([
        supabase
          .from("folders")
          .select("*")
          .eq("project_id", projectId!)
          .order("created_at"),
        supabase
          .from("workflows")
          .select("id, project_id, folder_id, name, created_at, updated_at")
          .eq("project_id", projectId!)
          .order("created_at", { ascending: false }),
      ])
      if (foldersRes.error) throw foldersRes.error
      if (workflowsRes.error) throw workflowsRes.error
      return {
        folders: foldersRes.data.map(toFolder),
        workflowMetas: workflowsRes.data.map(toWorkflowMeta),
      }
    },
    enabled: !!projectId,
    staleTime: 30_000,
  })
}

// --- Mutations ---
// Keep mutations in Zustand's useProjectsStore for optimistic updates.
// After each mutation completes, invalidate the React Query cache:
//
//   const qc = useQueryClient()
//   // after createProject, deleteProject, updateProject:
//   qc.invalidateQueries({ queryKey: queryKeys.projects.list() })
//   // after createFolder, renameFolder, deleteFolder, createWorkflow, etc.:
//   qc.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) })
//
// See Section 4 for the hybrid Zustand + React Query pattern.
```

### 2.10 `hooks/queries/use-admin-queries.ts`

```ts
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { createClient } from "@/lib/supabase"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"

// --- Types ---
export interface AdminStats {
  readonly totalUsers: number
  readonly totalProjects: number
  readonly totalWorkflows: number
  readonly totalJobs: number
  readonly jobsByStatus: Record<string, number>
  readonly totalCreditsUsed: number
}

export interface AdminUser {
  readonly id: string
  readonly email: string
  readonly full_name: string | null
  readonly subscription_tier: string
  readonly subscription_credits: number
  readonly topup_credits: number
  readonly daily_spent_credits: number
  readonly storage_used_bytes: number
  readonly storage_limit_bytes: number
  readonly role: string
  readonly created_at: string
}

interface AdminJob {
  readonly id: string
  readonly status: string
  readonly credits_used: number | null
  readonly credits_estimated: number | null
  readonly created_at: string
  readonly user_email: string
  readonly workflow_name: string
}

interface AdminUsageLog {
  readonly id: string
  readonly action: string
  readonly provider: string
  readonly credits_used: number
  readonly created_at: string
  readonly user_email: string
}

// --- Queries ---

export function useAdminStats() {
  return useQuery({
    queryKey: queryKeys.admin.stats(),
    queryFn: async (): Promise<AdminStats> => {
      const supabase = createClient()
      const [usersRes, projectsRes, workflowsRes, jobsCountRes, jobsStatusRes, usageRes] =
        await Promise.all([
          supabase.from("profiles").select("id", { count: "exact", head: true }),
          supabase.from("projects").select("id", { count: "exact", head: true }),
          supabase.from("workflows").select("id", { count: "exact", head: true }),
          supabase.from("jobs").select("id", { count: "exact", head: true }),
          supabase.from("jobs").select("status"),
          supabase.from("usage_logs").select("credits_used"),
        ])
      const jobsByStatus: Record<string, number> = {}
      for (const job of jobsStatusRes.data ?? []) {
        jobsByStatus[job.status] = (jobsByStatus[job.status] ?? 0) + 1
      }
      const totalCreditsUsed = (usageRes.data ?? []).reduce(
        (sum: number, log: { credits_used?: number }) => sum + (log.credits_used ?? 0),
        0,
      )
      return {
        totalUsers: usersRes.count ?? 0,
        totalProjects: projectsRes.count ?? 0,
        totalWorkflows: workflowsRes.count ?? 0,
        totalJobs: jobsCountRes.count ?? 0,
        jobsByStatus,
        totalCreditsUsed,
      }
    },
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useAdminUsers(page: number, pageSize = 50) {
  return useQuery({
    queryKey: queryKeys.admin.users(page, pageSize),
    queryFn: async (): Promise<AdminUser[]> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, email, full_name, subscription_tier, subscription_credits, topup_credits, daily_spent_credits, storage_used_bytes, storage_limit_bytes, role, created_at",
        )
        .order("created_at", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)
      if (error) throw error
      return (data ?? []).map((row) => ({
        ...row,
        subscription_tier: row.subscription_tier ?? "free",
        subscription_credits: row.subscription_credits ?? 0,
        topup_credits: row.topup_credits ?? 0,
        daily_spent_credits: row.daily_spent_credits ?? 0,
        storage_limit_bytes: row.storage_limit_bytes ?? 524288000,
      }))
    },
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useAdminJobs(page: number, pageSize = 50, statusFilter?: string) {
  return useQuery({
    queryKey: queryKeys.admin.jobs(page, pageSize, statusFilter),
    queryFn: async (): Promise<AdminJob[]> => {
      const supabase = createClient()
      let query = supabase
        .from("jobs")
        .select("id, status, credits_used, credits_estimated, created_at, user_id, workflow_id")
        .order("created_at", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)
      if (statusFilter) query = query.eq("status", statusFilter)
      const { data: jobs, error } = await query
      if (error) throw error
      if (!jobs || jobs.length === 0) return []
      const userIds = [...new Set(jobs.map((j) => j.user_id))]
      const workflowIds = [...new Set(jobs.map((j) => j.workflow_id).filter(Boolean) as string[])]
      const [usersRes, workflowsRes] = await Promise.all([
        supabase.from("profiles").select("id, email").in("id", userIds),
        supabase.from("workflows").select("id, name").in("id", workflowIds),
      ])
      const userMap = new Map((usersRes.data ?? []).map((u) => [u.id, u.email]))
      const wfMap = new Map((workflowsRes.data ?? []).map((w) => [w.id, w.name]))
      return jobs.map((j) => ({
        id: j.id,
        status: j.status,
        credits_used: j.credits_used,
        credits_estimated: j.credits_estimated,
        created_at: j.created_at,
        user_email: userMap.get(j.user_id) ?? "Unknown",
        workflow_name: wfMap.get(j.workflow_id ?? "") ?? "Unknown",
      }))
    },
    enabled: hasAdmin(),
    staleTime: 15_000,
  })
}

export function useAdminUsageLogs(page: number, pageSize = 50) {
  return useQuery({
    queryKey: queryKeys.admin.usageLogs(page, pageSize),
    queryFn: async (): Promise<AdminUsageLog[]> => {
      const supabase = createClient()
      const { data: logs, error } = await supabase
        .from("usage_logs")
        .select("id, action, provider, credits_used, created_at, user_id")
        .order("created_at", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)
      if (error) throw error
      if (!logs || logs.length === 0) return []
      const userIds = [...new Set(logs.map((l) => l.user_id))]
      const { data: users } = await supabase
        .from("profiles")
        .select("id, email")
        .in("id", userIds)
      const userMap = new Map((users ?? []).map((u) => [u.id, u.email]))
      return logs.map((l) => ({
        id: l.id,
        action: l.action,
        provider: l.provider,
        credits_used: l.credits_used,
        created_at: l.created_at,
        user_email: userMap.get(l.user_id) ?? "Unknown",
      }))
    },
    enabled: hasAdmin(),
    staleTime: 15_000,
  })
}

export function useAdminModels() {
  return useQuery({
    queryKey: queryKeys.admin.models(),
    queryFn: async () => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/v1/admin/models`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      if (!res.ok) throw new Error("Failed to fetch models")
      return res.json() as Promise<{ data: unknown[] }>
    },
    enabled: hasAdmin(),
    staleTime: 60_000,
  })
}

export function useAdminReports(page: number, status?: string) {
  return useQuery({
    queryKey: queryKeys.admin.reports(page, status),
    queryFn: async () => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const params = new URLSearchParams({
        userId: session?.user?.id ?? "",
        page: String(page),
        limit: "20",
      })
      if (status) params.set("status", status)
      const res = await fetch(`/v1/admin/gallery-reports?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      if (!res.ok) throw new Error("Failed to fetch reports")
      return res.json()
    },
    enabled: hasAdmin(),
    staleTime: 15_000,
  })
}

export function useAdminAlerts() {
  return useQuery({
    queryKey: queryKeys.admin.alerts(),
    queryFn: async () => {
      const res = await fetch(`/v1/admin/alerts`)
      if (!res.ok) throw new Error("Failed to fetch alerts")
      return res.json()
    },
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useAdminSettings() {
  return useQuery({
    queryKey: queryKeys.admin.settings(),
    queryFn: async () => {
      const res = await fetch(`/v1/admin/settings`)
      if (!res.ok) throw new Error("Failed to fetch settings")
      const data = await res.json()
      const settings = data.settings as Record<string, unknown>
      return {
        ai_provider: (settings.ai_provider as "replicate" | "kie") ?? "replicate",
        cost_markup_percent: (settings.cost_markup_percent as number) ?? 25,
      }
    },
    enabled: hasAdmin(),
    staleTime: 60_000,
  })
}

export function useAdminUserTransactions(userId: string) {
  return useQuery({
    queryKey: queryKeys.admin.userTransactions(userId),
    queryFn: async () => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/v1/admin/users/${userId}/transactions?limit=20`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      if (!res.ok) throw new Error("Failed to fetch transactions")
      return res.json()
    },
    enabled: hasAdmin() && !!userId,
    staleTime: 30_000,
  })
}

// --- Mutations ---

export function useUpdateModelPricingMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ modelId, pricing }: { modelId: string; pricing: unknown }) => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/v1/admin/models/${modelId}/pricing`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify(pricing),
      })
      if (!res.ok) throw new Error("Failed to update pricing")
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.models() })
    },
  })
}

export function useAdminAdjustCreditsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { userId: string; amount: number; type: string }) => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/v1/admin/users/${params.userId}/credits`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ amount: params.amount, type: params.type }),
      })
      if (!res.ok) throw new Error("Failed to adjust credits")
      return res.json()
    },
    onSuccess: () => {
      // Invalidate ALL admin user pages, not just page 0
      qc.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

export function useResolveReportMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ reportId, action }: { reportId: string; action: string }) => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/v1/admin/gallery-reports/${reportId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error("Failed to resolve report")
      return res.json()
    },
    onSuccess: () => {
      // Invalidate ALL admin report pages, not just page 0
      qc.invalidateQueries({ queryKey: ["admin", "reports"] })
      qc.invalidateQueries({ queryKey: queryKeys.gallery.reportCount() })
    },
  })
}

export function useCreateAlertMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (alert: Record<string, unknown>) => {
      const res = await fetch(`/v1/admin/alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(alert),
      })
      if (!res.ok) throw new Error("Failed to create alert")
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.alerts() })
    },
  })
}

export function useUpdateAlertMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Record<string, unknown>) => {
      const res = await fetch(`/v1/admin/alerts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
      if (!res.ok) throw new Error("Failed to update alert")
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.alerts() })
    },
  })
}

export function useDeleteAlertMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/v1/admin/alerts/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete alert")
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.alerts() })
    },
  })
}
```

---

## 3. Per-Site Migration Instructions

Each entry lists: **file path**, **current pattern** (what to delete), and **replacement** (what to use).

---

### 3.1 Credits Domain

#### Site 1: `useUserCredits` hook in `CreditBalance.tsx`

**File:** `src/components/credits/CreditBalance.tsx`

**Delete:** Lines 9–46 (the `useUserCredits` function with `useState`, `useCallback`, `useEffect` + `setInterval`)

**Replace with:**

```tsx
import { useUserCredits } from "@/hooks/queries/use-credits-queries"

// In CreditBalance component:
const { data: balance, isLoading, error } = useUserCredits(userId)
```

The hook from `use-credits-queries.ts` already has `refetchInterval: 30_000`, so all polling is handled automatically. Every component that calls `useUserCredits(userId)` shares the same cache — no duplicate polling.

> **IMPORTANT:** Sites 1, 2, and 4 must be migrated atomically (same PR). `useUserCredits` is currently exported from `CreditBalance.tsx` and imported by `GenerateButton.tsx` and `billing/page.tsx`. If Site 1 is migrated alone without updating the other consumers, they will break.

#### Site 2: `GenerateButton.tsx` inline credit cost fetch

**File:** `src/components/credits/GenerateButton.tsx`

**Delete:** The `useEffect` that calls `getModelCreditCost(modelIdentifier)` and the `creditCost` useState.

**Replace with:**

```tsx
import { useModelCreditCost, useUserCredits } from "@/hooks/queries/use-credits-queries"

const { data: creditCost } = useModelCreditCost(modelIdentifier)
const { data: balance } = useUserCredits(userId)
```

#### Site 3: `useModelCredits` hook

**File:** `src/hooks/use-model-credits.ts`

**After migration:** Gut the file's contents and re-export from the new queries file. This preserves backward compatibility for any remaining imports.

```ts
export { useModelCreditCost as useModelCredits } from "./queries/use-credits-queries"
export { getCachedCredits, prefetchModelCredits } from "./queries/use-credits-queries"
```

Note: `getCachedCredits(model)` and `prefetchModelCredits(models)` both use a module-level `queryClient` import internally — callers pass only the model argument(s), matching the existing call sites in `workflow-editor.tsx`.

---

### 3.2 Billing Domain

#### Site 4: `BillingPage` — subscription + transactions + storage

**File:** `src/app/(dashboard)/billing/page.tsx`

**Delete:** All 6 `useState` slices (`subscription`, `transactions`, `subLoading`, `txLoading`, `storageUsed`, `storageLimit`), the `loadBillingData` callback, both `useEffect` hooks, and the `manageLoading` state.

**Replace with:**

```tsx
import { useSubscription, useTransactions, useStorageProfile, useManageSubscriptionMutation } from "@/hooks/queries/use-billing-queries"
import { useUserCredits } from "@/hooks/queries/use-credits-queries"

const { data: subscription, isLoading: subLoading } = useSubscription(user?.id)
const { data: transactions, isLoading: txLoading } = useTransactions(user?.id)
const { data: storage } = useStorageProfile(user?.id)
const { data: balance } = useUserCredits(user?.id)
const manageMutation = useManageSubscriptionMutation()
```

For the `?success=true` checkout redirect, add a `useEffect` that invalidates after delay:

```tsx
const qc = useQueryClient()

useEffect(() => {
  if (!searchParams.get("success") && !searchParams.get("topup")) return
  const timer = setTimeout(() => {
    qc.invalidateQueries({ queryKey: queryKeys.billing.all })
    qc.invalidateQueries({ queryKey: queryKeys.credits.balance(user!.id) })
  }, 3000)
  return () => clearTimeout(timer)
}, [searchParams, user?.id, qc])
```

#### Site 5: `PricingPage` — subscription

**File:** `src/app/pricing/page.tsx`

**Delete:** `subscription` and `subLoading` useState, the useEffect that fetches subscription.

**Replace with:**

```tsx
import { useSubscription, useChangePlanMutation } from "@/hooks/queries/use-billing-queries"

const { data: subscription, isLoading: subLoading } = useSubscription(user?.id)
const changePlanMutation = useChangePlanMutation()
```

Benefit: shares the same cached subscription data with `BillingPage` — no duplicate fetch.

---

### 3.3 Stats Domain

#### Site 6: `StatsOverview` component

**File:** `src/components/dashboard/stats-overview.tsx`

**Delete:** `stats`, `loading`, `error` useState, `fetchStats` useCallback, useEffect.

**Replace with:**

```tsx
import { useStats } from "@/hooks/queries/use-stats-queries"

const { data: stats, isLoading: loading, error } = useStats(scope, user?.id)
```

#### Site 7: `ExecutionsTab` — jobs + stats

**File:** `src/components/editor/executions-tab.tsx`

**Delete:** `jobs`, `loading`, `error`, `nextCursor`, `stats`, `refreshing` useState, both `fetchStats` and `fetchData` useCallback hooks, useEffect.

**Replace with:**

```tsx
import { useStats } from "@/hooks/queries/use-stats-queries"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { getJobs } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"

const { data: stats } = useStats("user", userId)
const [cursor, setCursor] = useState<string | undefined>()
const { data: jobsData, isLoading } = useQuery({
  queryKey: queryKeys.jobs.list(userId ?? "", cursor),
  queryFn: () => getJobs(userId, cursor),
  enabled: !!userId,
  staleTime: 15_000,
})

const jobs = jobsData?.data ?? []
const nextCursor = jobsData?.next  // Note: getJobs() returns { data, next, previous }, NOT nextCursor
```

> **Note (P2):** This cursor-in-key approach creates independent per-page cache entries that go stale independently. Consider migrating to `useInfiniteQuery` for consistency with gallery and library. Not blocking — the current approach works, but `useInfiniteQuery` is the recommended pattern for paginated lists.

#### Site 8: `workflow-editor.tsx` — 10s stats polling for badge

**File:** `src/components/editor/workflow-editor.tsx`

**Delete:** The `setInterval(fetchStats, 10_000)` + the `fetchStats` function that calls `getStats("user", userId)`.

**Replace with:**

```tsx
import { useStats } from "@/hooks/queries/use-stats-queries"

const { data: stats } = useStats("user", userId, { refetchInterval: 10_000 })
const activeJobCount = stats?.processing ?? 0
```

> **Merge conflict note:** Sites 8, 37, and the `getCachedCredits` calls are all in `workflow-editor.tsx` (3500+ lines). These 3 changes (stats polling, imperative credit check, getCachedCredits calls) should be done in a single focused PR for `workflow-editor.tsx` to minimize merge conflict risk.

---

### 3.4 User Settings Domain

#### Site 9: `useLoadUserSettings` hook

**File:** `src/hooks/use-load-user-settings.ts`

**Delete:** The entire file contents.

**Replace with a thin wrapper that syncs query data to Zustand (one-time init, not on background refetches):**

```ts
import { useEffect, useRef } from "react"
import { useAuth } from "./use-auth"
import { useWorkflowStore } from "./use-workflow-store"
import { useUserSettings } from "./queries/use-user-settings-queries"

export function useLoadUserSettings() {
  const { user } = useAuth()
  const { data } = useUserSettings(user?.id)
  const initialized = useRef(false)

  useEffect(() => {
    if (!data || initialized.current) return
    initialized.current = true
    useWorkflowStore.getState().setUserPromptTemplates(data.promptTemplates)
  }, [data])
}
```

> **Why the ref guard?** Without it, a background refetch that returns fresh data would fire the `useEffect` again and overwrite any locally-edited prompt templates that the user hasn't saved yet. The `initialized` ref ensures we only sync once on mount.

#### Site 10: `SettingsPage`

**File:** `src/app/(dashboard)/settings/page.tsx`

**Delete:** `publicOutputs`, `tier`, `settingsLoading`, `saving`, `templates`, `savedTemplates`, `savingTemplates` useState, `fetchSettings` inner function, useEffect.

**Replace with:**

```tsx
import { useUserSettings, useUpdatePublicOutputsMutation, useSaveTemplatesMutation } from "@/hooks/queries/use-user-settings-queries"

const { data: settings, isLoading: settingsLoading } = useUserSettings(user?.id)
const toggleMutation = useUpdatePublicOutputsMutation()
const templatesMutation = useSaveTemplatesMutation()

// Derive local state from query data
const publicOutputs = settings?.publicOutputs ?? true
const tier = settings?.tier ?? "free"

// Call mutations with userId from useAuth():
// toggleMutation.mutate({ userId: user!.id, publicOutputs: newValue })
// templatesMutation.mutate({ userId: user!.id, promptTemplates: newTemplates })
```

---

### 3.5 App Settings Domain

#### Site 11: `useAppSettings` hook

**File:** `src/hooks/use-app-settings.ts`

**After migration:** Gut the file and re-export from the queries file:

```ts
export { useAppSettings, useIsKieProvider } from "./queries/use-app-settings-queries"
export type { AppSettings } from "./queries/use-app-settings-queries"
```

This preserves backward compatibility for all existing imports.

#### Site 12: `useAdmin().fetchSettings()` + `updateSetting()`

These are replaced by `useAdminSettings()` and `useUpdateSettingMutation()` from `use-admin-queries.ts`. The admin settings page should use the `admin.settings()` query key (which hits the same `/v1/admin/settings` endpoint) rather than the separate `appSettings.all` key, so that admin-only query invalidation is isolated. After a successful update, invalidate both:

```ts
qc.invalidateQueries({ queryKey: queryKeys.admin.settings() })
qc.invalidateQueries({ queryKey: queryKeys.appSettings.all })
```

---

### 3.6 Gallery Domain

#### Site 13: `GalleryPage` — infinite scroll

**File:** `src/app/gallery/page.tsx`

**Delete:** `items`, `nextCursor`, `loading`, `loadingMore` useState, `fetchGallery` useCallback, both useEffect hooks (initial load + IntersectionObserver).

**Replace with:**

```tsx
import { useGalleryInfinite, useReportGalleryItemMutation, useDeleteGalleryItemMutation } from "@/hooks/queries/use-gallery-queries"
import { useInView } from "react-intersection-observer" // or keep manual IntersectionObserver

const {
  data,
  isLoading: loading,
  isFetchingNextPage: loadingMore,
  hasNextPage,
  fetchNextPage,
} = useGalleryInfinite(filter)

const items = data?.pages.flatMap((p) => p.data) ?? []
const reportMutation = useReportGalleryItemMutation()
const deleteMutation = useDeleteGalleryItemMutation()
```

For infinite scroll, use the existing `IntersectionObserver` ref pattern or install `react-intersection-observer`:

```tsx
// Keep the existing sentinel ref pattern, but call:
if (hasNextPage && !loadingMore) fetchNextPage()
// instead of fetchGallery(nextCursor, true)
```

#### Site 14: `AdminLayout` — report count polling (60s)

**File:** `src/layouts/admin-layout.tsx`

**Delete:** `pendingReportsCount` useState, the useEffect with `setInterval(fetchCount, 60_000)`.

**Replace with:**

```tsx
import { useGalleryReportCount } from "@/hooks/queries/use-gallery-queries"

const { data: pendingReportsCount = 0 } = useGalleryReportCount()
```

The hook has `refetchInterval: 60_000` built in.

#### Site 15: `AppSidebar` — report count polling (60s, duplicate)

**File:** `src/components/layout/app-sidebar.tsx`

**Delete:** `pendingReportsCount` useState, the useEffect with `setInterval(fetchCount, 60_000)`.

**Replace with:**

```tsx
import { useGalleryReportCount } from "@/hooks/queries/use-gallery-queries"

const { data: pendingReportsCount = 0 } = useGalleryReportCount()
```

Both `AdminLayout` and `AppSidebar` now share the same cached count — no duplicate polling.

---

### 3.7 Assets Domain

#### Site 16: `CharacterGalleryButton`

**File:** `src/components/editor/character-gallery.tsx`

**Delete:** `dbCharacters`, `loading`, `error` useState, `fetchCharacters` useCallback, useEffect.

**Replace with:**

```tsx
import { useCharacters } from "@/hooks/queries/use-assets-queries"

const { data: dbCharacters = [], isLoading: loading, error } = useCharacters(projectId, userId)
```

Note: The current code only fetches when `open === true`. With React Query, data stays cached. If you want to skip the initial fetch until the modal opens, pass `enabled: open && !!userId` — but this is optional since the cache serves stale data instantly on re-open.

#### Site 17: `ObjectGalleryButton`

**File:** `src/components/editor/object-gallery.tsx`

Same pattern as Site 16:

```tsx
import { useObjects } from "@/hooks/queries/use-assets-queries"

const { data: dbObjects = [], isLoading: loading, error } = useObjects(projectId, userId)
```

#### Site 18: `LocationGalleryButton`

**File:** `src/components/editor/location-gallery.tsx`

Same pattern:

```tsx
import { useLocations } from "@/hooks/queries/use-assets-queries"

const { data: dbLocations = [], isLoading: loading, error } = useLocations(projectId, userId)
```

#### Site 19: `AssetSelectionModal` — 4 parallel fetches

**File:** `src/components/editor/asset-selection-modal.tsx`

**Delete:** `assets`, `loading`, `error` useState, the useEffect that calls `Promise.all([getCharacters, getObjects, getLocations, getFaces])`.

**Replace with:**

```tsx
import { useCharacters, useObjects, useLocations, useFaces } from "@/hooks/queries/use-assets-queries"

const characters = useCharacters(undefined, userId)
const objects = useObjects(undefined, userId)
const locations = useLocations(undefined, userId)
const faces = useFaces(undefined, userId)

const loading = characters.isLoading || objects.isLoading || locations.isLoading || faces.isLoading
const error = characters.error || objects.error || locations.error || faces.error

const assets = {
  characters: characters.data ?? [],
  objects: objects.data ?? [],
  locations: locations.data ?? [],
  faces: faces.data ?? [],
}
```

All 4 queries fire in parallel automatically; results are cached and shared with gallery buttons.

#### Site 20: `UnifiedAssetLibraryModal` — 4 asset types + projects

**File:** `src/components/editor/unified-asset-library.tsx`

**Delete:** Both `fetchAllAssets` and `fetchProjects` useCallback hooks, their useState/useEffect triads.

**Replace with same 4 hooks as Site 19**, plus:

```tsx
import { useProjects } from "@/hooks/queries/use-projects-queries"

const { data: projects = [] } = useProjects()
```

#### Site 21: `MediaLibraryModal` — paginated library

**File:** `src/components/editor/media-library-modal.tsx`

**Delete:** `assets`, `loading`, `filterType`, `nextCursor`, `loadingMore` useState, `fetchAssets` useCallback, debounce useEffect.

**Replace with:**

```tsx
import { useLibraryInfinite } from "@/hooks/queries/use-assets-queries"

const { data, isLoading: loading, isFetchingNextPage: loadingMore, hasNextPage, fetchNextPage } =
  useLibraryInfinite({
    userId: user?.id,
    type: filterType,
    search: debouncedSearch,
    owned: false,
    limit: 40,
  })

const assets = data?.pages.flatMap((p) => p.data) ?? []
```

Keep the 300ms debounce on search text (local state), but remove the manual cursor management.

#### Site 22: `LibraryPage` — user library + storage

**File:** `src/app/(dashboard)/library/page.tsx`

**Delete:** `assets`, `loading`, `loadingMore`, `nextCursor`, `storageUsed`, `storageLimit` useState, `loadStorage` and `loadAssets` useCallback, useEffect.

**Replace with:**

```tsx
import { useLibraryInfinite, useDeleteLibraryAssetMutation } from "@/hooks/queries/use-assets-queries"
import { useStorageProfile } from "@/hooks/queries/use-billing-queries"

const { data, isLoading: loading, isFetchingNextPage: loadingMore, hasNextPage, fetchNextPage } =
  useLibraryInfinite({
    userId: user?.id,
    type: filter,
    owned: true,
    limit: 40,
  })
const assets = data?.pages.flatMap((p) => p.data) ?? []
const { data: storage } = useStorageProfile(user?.id)
const deleteMutation = useDeleteLibraryAssetMutation()
```

---

### 3.8 Editor Domain

#### Site 23: `CostTab` — workflow cost summary

**File:** `src/components/editor/cost-tab.tsx`

**Delete:** `summary`, `loading`, `error` useState, `fetchCostSummary` useCallback, the deduplication useEffect with `prevJobIdsRef`.

**Replace with:**

```tsx
import { useWorkflowCostSummary } from "@/hooks/queries/use-editor-queries"

// Collect jobIds from nodes (same logic as current)
const jobIds = useMemo(() => {
  return nodes
    .filter((n) => n.data?.jobId)
    .map((n) => n.data.jobId as string)
}, [nodes])

const { data: summary, isLoading: loading, error } = useWorkflowCostSummary(jobIds)
```

React Query handles deduplication automatically — the sorted `jobIds` array in the query key ensures same set = same cache entry.

#### Site 24: `ImportCharacterModal` — importable workflows

**File:** `src/components/editor/import-character-modal.tsx`

**Delete:** `workflows`, `loading`, `error` useState, the useEffect that queries Supabase.

**Replace with:**

```tsx
import { useImportableWorkflows } from "@/hooks/queries/use-editor-queries"

const { data: workflows = [], isLoading: loading, error } =
  useImportableWorkflows(projectId, currentWorkflowId, isOpen)
```

---

### 3.9 Projects Domain

#### Site 25: `ProjectsPage`

**File:** `src/app/(dashboard)/projects/page.tsx`

**Delete:** The `useEffect` that calls `fetchProjects()`.

**Replace with:**

```tsx
import { useProjects } from "@/hooks/queries/use-projects-queries"

const { data: projects = [], isLoading: loading } = useProjects()
```

Keep the existing `useProjectsStore` for mutations (create, delete, update) — but after each mutation, invalidate:

```tsx
const qc = useQueryClient()
// After createProject / deleteProject / updateProject:
qc.invalidateQueries({ queryKey: queryKeys.projects.list() })
```

#### Site 26: `ProjectPage` (route: `/projects/:id`)

**File:** `src/routes/project-page.tsx`

**Delete:** The `useEffect` that calls `fetchProjectData(projectId)`.

**Replace with:**

```tsx
import { useProjectData } from "@/hooks/queries/use-projects-queries"

const { data, isLoading: loading } = useProjectData(projectId)
const folders = data?.folders ?? []
const workflowMetas = data?.workflowMetas ?? []
```

After mutations (createFolder, createWorkflow, etc.), invalidate:

```tsx
qc.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) })
```

---

### 3.10 Admin Domain

All 9 admin pages currently use the monolithic `useAdmin()` hook or their own inline fetch logic. After migration, each page imports from `use-admin-queries.ts`.

#### Site 27: `AdminDashboard`

**File:** `src/app/(admin)/admin/page.tsx`

**Delete:** `stats` useState, useEffect calling `fetchStats()`, `useAdmin()` import.

**Replace with:**

```tsx
import { useAdminStats } from "@/hooks/queries/use-admin-queries"

const { data: stats, isLoading: loading, error } = useAdminStats()
```

#### Site 28: `AdminUsersPage`

**File:** `src/app/(admin)/admin/users/page.tsx`

**Delete:** `users` local state, the useEffect calling `fetchUsers(page)`, all inline mutation functions with duplicated `getAuthHeaders()`.

**Replace with:**

```tsx
import { useAdminUsers, useAdminAdjustCreditsMutation, useAdminUserTransactions } from "@/hooks/queries/use-admin-queries"

const { data: users = [], isLoading: loading } = useAdminUsers(page, pageSize)
const adjustCreditsMutation = useAdminAdjustCreditsMutation()
```

For the `UserExpandedRow` (per-user transactions on expand):

```tsx
const { data: transactions, isLoading: txLoading } = useAdminUserTransactions(userId)
```

#### Site 29: `AdminJobsPage`

**File:** `src/app/(admin)/admin/jobs/page.tsx`

**Delete:** `jobs` local state, useEffect calling `fetchJobs(page, 50, statusFilter)`.

**Replace with:**

```tsx
import { useAdminJobs } from "@/hooks/queries/use-admin-queries"

const { data: jobs = [], isLoading: loading } = useAdminJobs(page, 50, statusFilter)
```

#### Site 30: `AdminUsagePage`

**File:** `src/app/(admin)/admin/usage/page.tsx`

**Delete:** `logs` local state, useEffect calling `fetchUsageLogs(page)`.

**Replace with:**

```tsx
import { useAdminUsageLogs } from "@/hooks/queries/use-admin-queries"

const { data: logs = [], isLoading: loading } = useAdminUsageLogs(page, 50)
```

#### Site 31: `AdminModelPricingPage`

**File:** `src/app/(admin)/admin/models/page.tsx`

**Delete:** `models`, `loading` useState, `fetchModels` useCallback, useEffect, inline auth header construction.

**Replace with:**

```tsx
import { useAdminModels, useUpdateModelPricingMutation } from "@/hooks/queries/use-admin-queries"

const { data: modelsData, isLoading: loading } = useAdminModels()
const models = modelsData?.data ?? []
const updatePricingMutation = useUpdateModelPricingMutation()
```

#### Site 32: `AdminPricingPage`

**File:** `src/app/(admin)/admin/pricing/page.tsx`

**Delete:** `models`, `loading` useState, `fetchModels` useCallback, useEffect.

**Replace with:**

```tsx
import { useAdminModels } from "@/hooks/queries/use-admin-queries"

const { data: modelsData, isLoading: loading } = useAdminModels()
const models = modelsData?.data ?? []
```

Shares the same cache as `AdminModelPricingPage` (same `queryKeys.admin.models()` key).

#### Site 33: `AdminReportsPage`

**File:** `src/app/(admin)/admin/reports/page.tsx`

**Delete:** `reports`, `total`, `loading` useState, `fetchReports` useCallback, useEffect, inline auth headers.

**Replace with:**

```tsx
import { useAdminReports, useResolveReportMutation } from "@/hooks/queries/use-admin-queries"

const { data: reportsData, isLoading: loading } = useAdminReports(page, statusFilter)
const reports = reportsData?.data ?? []
const total = reportsData?.total ?? 0
const resolveMutation = useResolveReportMutation()
```

#### Site 34: `AdminAlertsPage`

**File:** `src/app/(admin)/admin/alerts/page.tsx`

**Delete:** `alerts`, `loading`, `error` useState, `fetchAlerts` useCallback, useEffect. Also remove `import { API_BASE_URL } from '@/lib/api'` and replace all 4 `${API_BASE_URL}/v1/admin/alerts` occurrences (lines 54, 75, 101, 118) with `/v1/admin/alerts`. This fixes a CLAUDE.md violation — admin pages must use same-origin relative paths, not `API_BASE_URL`.

**Replace with:**

```tsx
import {
  useAdminAlerts,
  useCreateAlertMutation,
  useUpdateAlertMutation,
  useDeleteAlertMutation,
} from "@/hooks/queries/use-admin-queries"

const { data: alertsData, isLoading: loading, error } = useAdminAlerts()
const alerts = alertsData?.data ?? []
const createAlert = useCreateAlertMutation()
const updateAlert = useUpdateAlertMutation()
const deleteAlert = useDeleteAlertMutation()
```

#### Site 35: `AdminSettingsPage`

**File:** `src/app/(admin)/admin/settings/page.tsx`

**Delete:** `settings` useState, useEffect calling `fetchSettings()`, `updateSetting` callback, `useAdmin()` import.

**Replace with:**

```tsx
import { useAdminSettings } from "@/hooks/queries/use-admin-queries"
import { useUpdateSettingMutation } from "@/hooks/queries/use-app-settings-queries"

const { data: settings, isLoading: loading } = useAdminSettings()
const updateSetting = useUpdateSettingMutation()

// Local state for form values, derived from query data:
const [provider, setProvider] = useState(settings?.ai_provider ?? "replicate")
const [markup, setMarkup] = useState(settings?.cost_markup_percent ?? 25)

useEffect(() => {
  if (settings) {
    setProvider(settings.ai_provider)
    setMarkup(settings.cost_markup_percent)
  }
}, [settings])
```

---

### 3.11 Remaining Fetch Sites

#### Site 36: `SearchModal`

**File:** `src/components/editor/search-modal.tsx`

**Delete:** `projects`, `workflows`, `loading` useState, `fetchResults` useCallback, debounce useEffect.

**Replace with:**

```tsx
import { useQuery } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase"
import { queryKeys } from "@/lib/query-keys"

const [debouncedQuery, setDebouncedQuery] = useState("")
// Keep existing 300ms debounce

const { data, isLoading: loading } = useQuery({
  queryKey: queryKeys.search.results(debouncedQuery),
  queryFn: async () => {
    const supabase = createClient()
    const [projectsRes, workflowsRes] = await Promise.all([
      supabase.from("projects").select("id, name").ilike("name", `%${debouncedQuery}%`).limit(10),
      supabase.from("workflows").select("id, name, project_id").ilike("name", `%${debouncedQuery}%`).limit(20),
    ])
    return {
      projects: projectsRes.data ?? [],
      workflows: workflowsRes.data ?? [],
    }
  },
  enabled: open && debouncedQuery.length > 0,
  staleTime: 10_000,
  gcTime: 2 * 60_000,  // 2 min — search results are transient, don't hold cache long
})
```

#### Site 37: `workflow-editor.tsx` — imperative credit check

See **Section 4.1** for the special `queryClient.fetchQuery` pattern. (See Site 8 merge conflict note — do all `workflow-editor.tsx` changes in one PR.)

#### Site 38: `workflow-editor.tsx` — 2s per-job polling

**File:** `src/components/editor/workflow-editor.tsx`

The 2-second job status polling (`getJobStatus(jobId)` / `getBatchJobStatus(jobIds)`) is an execution-time concern, not a data-fetching concern. **Do NOT migrate to React Query.** Keep the existing polling loop inside the DAG executor — it's imperative, has side effects (updating node data in Zustand), and terminates when the job completes. React Query's `refetchInterval` is the wrong tool for this pattern.

#### Site 39: `config-panel.tsx` — YouTube audio extraction polling

**File:** `src/components/editor/config-panel.tsx`

The recursive 2s `poll()` for YouTube audio extraction job status is also an execution-time imperative loop. **Do NOT migrate to React Query.** Same reasoning as Site 38.

#### Site 40: `config-panel.tsx` — upload endpoints

**File:** `src/components/editor/config-panel.tsx`

Upload calls (`uploadImage`, `uploadAudio`, `startVideoDownload`) are user-action-triggered mutations. They can optionally be wrapped in `useMutation` for loading/error state, but this is low priority since they already work fine with local state.

---

## 4. Special Patterns

### 4.1 Imperative credit check in `workflow-editor.tsx`

**Current:** Before execution, the editor calls `getUserCredits(userId)` imperatively (not in a hook) to check if the user has enough credits.

**Migration:** Use `queryClient.fetchQuery` — this reads from cache if fresh, or fetches if stale:

```tsx
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { getUserCredits, type UserBalance } from "@/lib/api"

// Inside handleRunWorkflow or similar:
const balance = await queryClient.fetchQuery({
  queryKey: queryKeys.credits.balance(userId),
  queryFn: async () => {
    const result = await getUserCredits(userId)
    return result.data ?? (result as unknown as UserBalance)
  },
  staleTime: 10_000, // use cached if <10s old
})

if (balance.total < requiredCredits) {
  // Show InsufficientCreditsModal
  return
}
```

### 4.2 `getCachedCredits` synchronous access

**Current:** `getCachedCredits(modelIdentifier)` reads from the module-level `Map` synchronously.

**Migration:** Same as Section 2.1 — the exported `getCachedCredits(model)` function uses the module-level `queryClient` singleton and `queryClient.getQueryData`. The 1-arg signature matches all existing call sites (e.g. `workflow-editor.tsx:115,3188` calling `getCachedCredits(provider)`).

### 4.3 Zustand side-effect for `useLoadUserSettings`

**Current:** `useLoadUserSettings` fetches `/v1/user/settings` and writes `promptTemplates` to `useWorkflowStore`.

**Migration:** The new `useLoadUserSettings` (see Site 9) uses `useUserSettings` from React Query and syncs to Zustand via `useEffect` on `data`. The Zustand store continues to own the runtime `userPromptTemplates` state for the canvas.

### 4.4 Edition gating with `enabled`

All hooks that fetch edition-gated endpoints use `enabled`:

| Hook | Gate |
|------|------|
| `useUserCredits` | `enabled: !!userId && hasCredits()` |
| `useModelCreditCost` | `enabled: !!model && hasCredits()` |
| `useSubscription` | `enabled: !!userId && hasCredits()` |
| `useTransactions` | `enabled: !!userId && hasCredits()` |
| `useStorageProfile` | `enabled: !!userId && hasCredits()` |
| `useWorkflowCostSummary` | `enabled: jobIds.length > 0 && hasCredits()` |
| `useAdminStats` | `enabled: hasAdmin()` |
| `useAdminUsers` | `enabled: hasAdmin()` |
| `useAdminJobs` | `enabled: hasAdmin()` |
| `useAdminModels` | `enabled: hasAdmin()` |
| `useGalleryReportCount` | `enabled: !!user?.id && isAdmin && hasAdmin()` |

In community edition (`VITE_EDITION=community`), none of the credit/admin hooks will fire.

### 4.5 Hybrid Zustand + React Query for Projects

The `useProjectsStore` Zustand store handles both queries and mutations with optimistic local state updates. Migration strategy:

1. **Queries** → React Query (`useProjects`, `useProjectData`)
2. **Mutations** → Keep in Zustand for optimistic updates, BUT call `queryClient.invalidateQueries` after each successful mutation

Example for `createProject`:

```tsx
// At the top of the Zustand store file:
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

// In useProjectsStore:
createProject: async (name, description = "") => {
  // ... existing Supabase insert + optimistic set ...

  // After success, invalidate React Query cache:
  queryClient.invalidateQueries({ queryKey: queryKeys.projects.list() })

  return project
},
```

> **Note:** Use a static import for `queryClient` — dynamic `await import()` is unnecessarily complex here since the query client module has no side effects at import time.

Alternative: Convert mutations to `useMutation` hooks and use `onMutate` for optimistic updates. This is cleaner but requires more refactoring. The hybrid approach above is the minimal-change path.

### 4.6 Post-checkout refetch with delay

***REDACTED-OSS-SCRUB***

**Migration:** Keep the 3s delay but use `invalidateQueries` instead of manual refetch:

```tsx
useEffect(() => {
  if (!searchParams.get("success") && !searchParams.get("topup")) return
  const timer = setTimeout(() => {
    qc.invalidateQueries({ queryKey: queryKeys.billing.all })
    qc.invalidateQueries({ queryKey: queryKeys.credits.balance(user!.id) })
  }, 3000)
  return () => clearTimeout(timer)
}, [searchParams])
```

### 4.7 Patterns NOT to migrate

These should NOT be moved to React Query:

| Pattern | Reason |
|---------|--------|
| `useAuth` (module-level singleton + Supabase realtime) | Not a standard fetch; uses `onAuthStateChange` subscription |
| Job status polling (2s per-job in DAG executor) | Imperative execution loop with side effects |
| YouTube audio extraction polling | Recursive imperative loop |
| SSE streaming (AI Writer) | Server-sent events, not request/response |
| File uploads | One-shot mutations, fine with local state |
| Supabase auth calls (`getUser`, `getSession`) | Auth layer, not data fetching |

---

## 5. Cleanup Checklist

### 5.1 Files to delete

| File | Reason |
|------|--------|
| `src/hooks/use-admin.ts` | Replaced by 16 hooks in `use-admin-queries.ts` |

### 5.2 Files to gut and re-export

| File | New contents |
|------|-------------|
| `src/hooks/use-model-credits.ts` | Re-export `useModelCreditCost`, `getCachedCredits`, `prefetchModelCredits` from queries |
| `src/hooks/use-app-settings.ts` | Re-export `useAppSettings`, `useIsKieProvider`, `AppSettings` from queries |
| `src/hooks/use-load-user-settings.ts` | Thin wrapper: `useUserSettings` + `useEffect` syncing to Zustand (file exists at 28 lines with `"use client"` directive) |
| `src/components/credits/CreditBalance.tsx` | Re-export `useUserCredits` from `use-credits-queries.ts`; keep `CreditBalance` component using the new hook. Required because `GenerateButton.tsx` and `billing/page.tsx` import `useUserCredits` from this file. |

### 5.3 Module-level caches to remove

| Cache | File | Replaced by |
|-------|------|-------------|
| `creditCache: Map<string, number>` | `use-model-credits.ts:8` | React Query cache (`queryKeys.credits.modelCost`) |
| `cachedSettings` + `fetchPromise` | `use-app-settings.ts:17-18` | React Query cache (`queryKeys.appSettings.all`) |

### 5.4 Polling intervals to remove

| Location | Current | Replaced by |
|----------|---------|-------------|
| `CreditBalance.tsx:41` | `setInterval(refetch, 30000)` | `refetchInterval: 30_000` in `useUserCredits` |
| `admin-layout.tsx:79` | `setInterval(fetchCount, 60_000)` | `refetchInterval: 60_000` in `useGalleryReportCount` |
| `app-sidebar.tsx:94` | `setInterval(fetchCount, 60_000)` | Same shared `useGalleryReportCount` |
| `workflow-editor.tsx` | `setInterval(fetchStats, 10_000)` | `refetchInterval: 10_000` in `useStats` |

### 5.5 State to remove from Zustand

After all consumers are migrated:

| Store | Fields to remove | Reason |
|-------|-----------------|--------|
| `useProjectsStore` | `fetchProjects`, `fetchProjectData`, `loading`, `error` | Replaced by `useProjects()`, `useProjectData()` |

Keep all mutation methods in `useProjectsStore` (they do optimistic updates), but add `queryClient.invalidateQueries` calls after each.

### 5.6 `"use client"` directives to remove

All hook files have `"use client"` directives from the previous Next.js setup. These are no-ops in Vite but harmless. Remove them during migration for cleanliness:

- `src/hooks/use-model-credits.ts`
- `src/hooks/use-app-settings.ts`
- `src/hooks/use-load-user-settings.ts`
- `src/hooks/use-admin.ts`
- `src/components/credits/CreditBalance.tsx`
- `src/components/credits/GenerateButton.tsx`

### 5.7 Duplicate fetch elimination

After migration, these duplicate fetches are eliminated by shared cache:

| Endpoint | Before (independent fetches) | After (shared cache) |
|----------|-----|------|
| `GET /v1/user/credits` | CreditBalance, GenerateButton, BillingPage — 3 separate 30s polls | Single `useUserCredits(userId)` with one 30s poll |
| `GET /v1/credits/model-cost` | `useModelCredits` (Map cache) + GenerateButton (own fetch) | Single `useModelCreditCost(model)` |
| `GET /v1/admin/settings` | `useAppSettings` (module cache) + `useAdmin().fetchSettings()` | Single `useAppSettings()` / `useAdminSettings()` |
| `GET /v1/admin/models` | AdminModelPricingPage + AdminPricingPage | Single `useAdminModels()` |
| `GET /v1/admin/gallery-reports/count` | AdminLayout + AppSidebar — 2 separate 60s polls | Single `useGalleryReportCount()` |
| `GET /v1/billing/subscription` | BillingPage + PricingPage | Single `useSubscription(userId)` |
| `GET /v1/user/settings` | SettingsPage + useLoadUserSettings | Single `useUserSettings(userId)` |
| Characters/Objects/Locations/Faces | 5 components fetching overlapping sets | Shared `useCharacters` / `useObjects` / `useLocations` / `useFaces` |
| `GET /v1/library` | LibraryPage + MediaLibraryModal | Shared `useLibraryInfinite` (params differ → different cache keys, but overlap is handled) |
| `GET /v1/stats` | StatsOverview + ExecutionsTab + workflow-editor | Single `useStats(scope, userId)` |

---

## 6. staleTime / gcTime Reference & Verification

### 6.1 staleTime / gcTime Table

| Hook | staleTime | gcTime | refetchInterval | Rationale |
|------|-----------|--------|-----------------|-----------|
| `useUserCredits` | 10s | 5min (default) | 30s | Credits change on job completion; poll frequently |
| `useModelCreditCost` | Infinity | 30min | — | Model costs are static at runtime |
| `useSubscription` | 60s | 5min | — | Subscription changes are rare |
| `useTransactions` | 60s | 5min | — | Only changes after new payment |
| `useStorageProfile` | 30s | 5min | — | Changes on upload/delete |
| `useStats` | 10s | 5min | 10s (editor) | Active job count needs frequent updates |
| `useUserSettings` | 60s | 5min | — | User changes settings infrequently |
| `useAppSettings` | 5min | 30min | — | Admin setting, very stable |
| `useGalleryInfinite` | 30s | 5min | — | New gallery items added slowly |
| `useGalleryReportCount` | 30s | 5min | 60s | Admin badge, low-priority |
| `useCharacters/Objects/Locations/Faces` | 60s | 5min | — | Assets change on create/delete |
| `useLibraryInfinite` | 30s | 5min | — | Library changes on upload/delete |
| `useWorkflowCostSummary` | 60s | 5min | — | Cost data is historical |
| `useImportableWorkflows` | 30s | 5min | — | Workflow list changes slowly |
| `useProjects` | 30s | 5min | — | Project list changes on CRUD |
| `useProjectData` | 30s | 5min | — | Folder/workflow list changes on CRUD |
| `useAdminStats` | 30s | 5min | — | Dashboard overview |
| `useAdminUsers` | 30s | 5min | — | User list changes slowly |
| `useAdminJobs` | 15s | 5min | — | Job list updates as jobs complete |
| `useAdminUsageLogs` | 15s | 5min | — | Logs append continuously |
| `useAdminModels` | 60s | 5min | — | Model config rarely changes |
| `useAdminReports` | 15s | 5min | — | Reports arrive from users |
| `useAdminAlerts` | 30s | 5min | — | Admin-configured alerts |
| `useAdminSettings` | 60s | 5min | — | Rarely changed |
| `SearchModal` (inline query) | 10s | 2min | — | Search results are transient; uses `queryKeys.search.results()` |

### 6.2 Verification Checklist

After completing the migration, verify each item:

- [ ] `bun add @tanstack/react-query @tanstack/react-query-devtools` succeeds
- [ ] `npx tsc --noEmit` passes in `frontend/`
- [ ] `bun run build` succeeds
- [ ] `QueryClientProvider` wraps the entire app in `main.tsx`
- [ ] `ReactQueryDevtools` renders in dev mode
- [ ] `query-client.ts` exports singleton `queryClient`
- [ ] `query-keys.ts` covers all ~25 query key patterns
- [ ] All 10 domain hook files created under `hooks/queries/`
- [ ] No `setInterval` remains for data fetching (grep for `setInterval`)
- [ ] No module-level `Map` or `let cached` caches remain in hook files
- [ ] `useAdmin` hook file deleted
- [ ] `use-model-credits.ts` re-exports from queries
- [ ] `use-app-settings.ts` re-exports from queries
- [ ] `use-load-user-settings.ts` uses React Query + Zustand sync
- [ ] All admin pages import from `use-admin-queries.ts`
- [ ] Gallery infinite scroll works with `useInfiniteQuery`
- [ ] Library page infinite scroll works with `useInfiniteQuery`
- [ ] CreditBalance shows balance without duplicate polling
- [ ] Billing + Pricing pages share subscription cache
- [ ] AdminLayout + AppSidebar share report count poll
- [ ] StatsOverview + ExecutionsTab + editor share stats cache
- [ ] Character/Object/Location/Face galleries share asset cache
***REDACTED-OSS-SCRUB***
- [ ] Imperative credit check uses `queryClient.fetchQuery`
- [ ] `getCachedCredits` uses `queryClient.getQueryData`
- [ ] Edition gating (`enabled: hasCredits() / hasAdmin()`) prevents unnecessary fetches in community/business editions
- [ ] `"use client"` directives removed from migrated hook files
- [ ] No `API_BASE_URL` used in admin alerts page (fixed to relative path)
- [ ] React Query DevTools show expected query count on each page
- [ ] No console errors or warnings related to React Query
