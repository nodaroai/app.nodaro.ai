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
    staleTime: 5 * 60_000,
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
      qc.invalidateQueries({ queryKey: queryKeys.admin.settings() })
    },
  })
}
