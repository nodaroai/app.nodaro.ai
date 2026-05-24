import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { getAuthHeaders } from "@/lib/api"
import type { GenerateTextTemplate } from "@/lib/generate-text-templates"

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
