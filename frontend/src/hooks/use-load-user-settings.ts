import { useEffect, useRef } from "react"
import { useAuth } from "./use-auth"
import { useWorkflowStore } from "./use-workflow-store"
import { useUserSettings } from "./queries/use-user-settings-queries"
import { useLocaleStore } from "@/lib/locale-store"
import type { LocaleId } from "@nodaro/shared/i18n"

export function useLoadUserSettings() {
  const { user } = useAuth()
  const { data } = useUserSettings(user?.id)
  const initializedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!data || !user?.id) return
    // The account's language: once per user for the page's life, which the
    // store itself guards (this hook remounts with its layout).
    useLocaleStore
      .getState()
      .markHydrated((data.preferredLocale ?? null) as LocaleId | null, user.id)
    if (initializedFor.current === user.id) return
    initializedFor.current = user.id
    useWorkflowStore.getState().setUserPromptTemplates(data.promptTemplates)
    useWorkflowStore.getState().setUserTextTemplates(data.textTemplates ?? [])
  }, [data, user?.id])
}
