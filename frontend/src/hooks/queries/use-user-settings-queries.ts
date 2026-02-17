import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase"
import { queryKeys } from "@/lib/query-keys"

interface UserSettings {
  publicOutputs: boolean
  tier: string
  promptTemplates: Record<string, string>
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) return { Authorization: `Bearer ${session.access_token}` }
  } catch { /* fall back to no auth */ }
  return {}
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

export function useSaveTemplatesMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, promptTemplates }: { userId: string; promptTemplates: Record<string, string> }) => {
      const authHeaders = await getAuthHeaders()
      const res = await fetch(`/v1/user/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders },
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
