import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { getAuthHeaders } from "@/lib/api"
import type { GenerateTextTemplate } from "@/lib/generate-text-templates"
import type { VariableDisplayMode } from "@/components/editor/config-panels/types"
import { DEFAULT_NODE_DOUBLE_CLICK_ACTION, type NodeDoubleClickAction } from "@/lib/node-double-click-action"

interface UserSettings {
  publicOutputs: boolean
  tier: string
  promptTemplates: Record<string, string>
  /** User-defined Generate Text templates (profiles.text_templates). Ungated —
   *  available to all editions, exactly like promptTemplates. */
  textTemplates: GenerateTextTemplate[]
  /** User-selected language for parameter-node picker labels/descriptions.
   *  null = browser-detected, falls back to English. */
  preferredLocale: string | null
  /** Editor Add Node menu — show the "Recent" shortcut category. */
  showRecentNodes: boolean
  /** Editor Add Node menu — show the "Most Used" shortcut category. */
  showMostUsedNodes: boolean
  /** How {nodeRef} placeholders render in prompt fields. Was a toolbar
   *  dropdown; now a Settings preference, so it has to survive a reload. */
  variableDisplayMode: VariableDisplayMode
  /** What double-clicking a canvas node does. */
  nodeDoubleClickAction: NodeDoubleClickAction
  /** MCP conversations become flows on the canvas (on unless turned off). */
  mcpFlowsEnabled: boolean
}

async function fetchUserSettings(userId: string): Promise<UserSettings> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`/v1/user/settings?userId=${encodeURIComponent(userId)}`, {
    headers: authHeaders,
  })
  if (!res.ok) throw new Error("Failed to fetch user settings")
  const json = await res.json()
  const data = json.data ?? json
  return {
    publicOutputs: data.publicOutputs ?? true,
    tier: data.tier ?? "free",
    promptTemplates: data.promptTemplates ?? {},
    textTemplates: data.textTemplates ?? [],
    preferredLocale: data.preferredLocale ?? null,
    showRecentNodes: data.showRecentNodes ?? false,
    showMostUsedNodes: data.showMostUsedNodes ?? false,
    variableDisplayMode: data.variableDisplayMode ?? "raw",
    nodeDoubleClickAction: data.nodeDoubleClickAction ?? DEFAULT_NODE_DOUBLE_CLICK_ACTION,
    mcpFlowsEnabled: data.mcpPreferences?.flows?.enabled !== false,
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
      const authHeaders = await getAuthHeaders()
      const res = await fetch(`/v1/user/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders },
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

/** Turn "MCP conversations become flows" on or off (`mcpPreferences.flows.enabled`). */
export function useUpdateMcpFlowsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, enabled }: { userId: string; enabled: boolean }) => {
      const authHeaders = await getAuthHeaders()
      const res = await fetch(`/v1/user/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ userId, mcpPreferences: { flows: { enabled } } }),
      })
      if (!res.ok) throw new Error("Failed to update settings")
      return res.json()
    },
    onSuccess: (_data, { userId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.userSettings.detail(userId) })
    },
  })
}

export function useUpdatePreferredLocaleMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      userId,
      preferredLocale,
    }: {
      userId: string
      preferredLocale: string | null
    }) => {
      const authHeaders = await getAuthHeaders()
      const res = await fetch(`/v1/user/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ userId, preferredLocale }),
      })
      if (!res.ok) throw new Error("Failed to update preferred locale")
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
    mutationFn: async ({
      userId,
      promptTemplates,
      textTemplates,
    }: {
      userId: string
      promptTemplates: Record<string, string>
      /** Optional — only included in the PATCH when present so a prompt-template
       *  save doesn't clobber text templates (PATCH-merge semantics). */
      textTemplates?: GenerateTextTemplate[]
    }) => {
      const authHeaders = await getAuthHeaders()
      const res = await fetch(`/v1/user/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          userId,
          promptTemplates,
          ...(textTemplates !== undefined ? { textTemplates } : {}),
        }),
      })
      if (!res.ok) throw new Error("Failed to save templates")
      return res.json()
    },
    onSuccess: (_data, { userId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.userSettings.detail(userId) })
    },
  })
}

export function useUpdateNodeMenuPrefsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      userId,
      showRecentNodes,
      showMostUsedNodes,
    }: {
      userId: string
      showRecentNodes?: boolean
      showMostUsedNodes?: boolean
    }) => {
      const authHeaders = await getAuthHeaders()
      const res = await fetch(`/v1/user/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ userId, showRecentNodes, showMostUsedNodes }),
      })
      if (!res.ok) throw new Error("Failed to update node menu preferences")
      return res.json()
    },
    // Optimistically flip the toggled field so the Switch — and the Add Node
    // popup, which reads this same query — update instantly. Roll back on error;
    // reconcile with the server on settle (so a failed refetch can't leave the
    // cache disagreeing with the persisted value).
    onMutate: async ({ userId, showRecentNodes, showMostUsedNodes }) => {
      const queryKey = queryKeys.userSettings.detail(userId)
      await qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData<UserSettings>(queryKey)
      if (previous) {
        qc.setQueryData<UserSettings>(queryKey, {
          ...previous,
          ...(showRecentNodes !== undefined ? { showRecentNodes } : {}),
          ...(showMostUsedNodes !== undefined ? { showMostUsedNodes } : {}),
        })
      }
      return { queryKey, previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) {
        qc.setQueryData(context.queryKey, context.previous)
      }
    },
    onSettled: (_data, _err, { userId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.userSettings.detail(userId) })
    },
  })
}

/**
 * Persist the editor's variable display mode.
 *
 * The mode used to be a toolbar dropdown backed by in-memory Zustand state, so
 * it reset to "raw" on every reload. As a Settings preference it has to stick,
 * which is what this writes. The editor still READS it from the store — see
 * `useSyncVariableDisplayMode`, which seeds the store from this query.
 */
export function useUpdateVariableDisplayModeMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, variableDisplayMode }: { userId: string; variableDisplayMode: VariableDisplayMode }) => {
      const authHeaders = await getAuthHeaders()
      const res = await fetch(`/v1/user/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ userId, variableDisplayMode }),
      })
      if (!res.ok) throw new Error("Failed to update variable display mode")
      return res.json()
    },
    // Optimistic, like the node-menu prefs: the Select and any open editor both
    // read this query, so the change lands without waiting on the round trip.
    onMutate: async ({ userId, variableDisplayMode }) => {
      const queryKey = queryKeys.userSettings.detail(userId)
      await qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData<UserSettings>(queryKey)
      if (previous) qc.setQueryData<UserSettings>(queryKey, { ...previous, variableDisplayMode })
      return { queryKey, previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) qc.setQueryData(context.queryKey, context.previous)
    },
    onSettled: (_data, _err, { userId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.userSettings.detail(userId) })
    },
  })
}

/**
 * Persist which action a double-click on a canvas node performs.
 *
 * Toggled from the editor toolbar rather than the Settings page — it is a
 * working preference you flip while editing, not something you go configure.
 * Optimistic so the toolbar flips instantly and the canvas honours the new
 * behaviour on the very next double-click.
 */
export function useUpdateNodeDoubleClickActionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, nodeDoubleClickAction }: { userId: string; nodeDoubleClickAction: NodeDoubleClickAction }) => {
      const authHeaders = await getAuthHeaders()
      const res = await fetch(`/v1/user/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ userId, nodeDoubleClickAction }),
      })
      if (!res.ok) throw new Error("Failed to update double-click action")
      return res.json()
    },
    onMutate: async ({ userId, nodeDoubleClickAction }) => {
      const queryKey = queryKeys.userSettings.detail(userId)
      await qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData<UserSettings>(queryKey)
      if (previous) qc.setQueryData<UserSettings>(queryKey, { ...previous, nodeDoubleClickAction })
      return { queryKey, previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) qc.setQueryData(context.queryKey, context.previous)
    },
    onSettled: (_data, _err, { userId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.userSettings.detail(userId) })
    },
  })
}
