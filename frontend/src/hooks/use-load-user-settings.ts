"use client"

import { useEffect } from "react"
import { useAuth } from "./use-auth"
import { useWorkflowStore } from "./use-workflow-store"

const API_BASE = ""

export function useLoadUserSettings() {
  const { user } = useAuth()

  useEffect(() => {
    if (!user?.id) return

    fetch(`${API_BASE}/v1/user/settings?userId=${user.id}`)
      .then((res) => res.json())
      .then((json) => {
        const data = json.data ?? json
        useWorkflowStore
          .getState()
          .setUserPromptTemplates((data.promptTemplates ?? {}) as Record<string, string>)
      })
      .catch((err) => {
        console.error("Failed to load user settings:", err)
      })
  }, [user?.id])
}
