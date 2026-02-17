import { useEffect, useRef } from "react"
import { useAuth } from "./use-auth"
import { useWorkflowStore } from "./use-workflow-store"
import { useUserSettings } from "./queries/use-user-settings-queries"

export function useLoadUserSettings() {
  const { user } = useAuth()
  const { data } = useUserSettings(user?.id)
  const initializedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!data || !user?.id) return
    if (initializedFor.current === user.id) return
    initializedFor.current = user.id
    useWorkflowStore.getState().setUserPromptTemplates(data.promptTemplates)
  }, [data, user?.id])
}
