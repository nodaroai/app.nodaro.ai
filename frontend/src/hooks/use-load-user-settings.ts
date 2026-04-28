import { useEffect, useRef } from "react"
import { useAuth } from "./use-auth"
import { useWorkflowStore } from "./use-workflow-store"
import { useUserSettings } from "./queries/use-user-settings-queries"
import { useLocaleStore } from "@/lib/locale-store"
import type { LocaleId } from "@nodaro/shared"

export function useLoadUserSettings() {
  const { user } = useAuth()
  const { data } = useUserSettings(user?.id)
  const initializedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!data || !user?.id) return
    if (initializedFor.current === user.id) return
    initializedFor.current = user.id
    useWorkflowStore.getState().setUserPromptTemplates(data.promptTemplates)
    // Hydrate the locale store from the user's saved preference. Falls back
    // to whatever the store inferred from localStorage / navigator.language.
    useLocaleStore
      .getState()
      .markHydrated((data.preferredLocale ?? null) as LocaleId | null)
  }, [data, user?.id])
}
