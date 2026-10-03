import { useCallback, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { resolveDefaultProjectId } from "@/lib/default-project"
import { tx } from "@/lib/i18n"

/**
 * Quick-create from the home screen: resolve the caller's default project
 * (lazy-created when missing — see `resolveDefaultProjectId`) and insert an
 * empty workflow. The URL still embeds the projectId so the editor's existing
 * save() path keeps working.
 *
 * `isCreating` drives the spinner on the New Workflow button and on the empty
 * state's CTA. The editor chunk is lazy-loaded, so the first navigation can
 * take a few seconds — without immediate feedback the click looks like a
 * no-op. It stays true through navigation; the page unmounts on navigate.
 */
export function useCreateWorkflow(): {
  readonly createWorkflow: () => Promise<void>
  readonly isCreating: boolean
} {
  const navigate = useNavigate()
  const [isCreating, setIsCreating] = useState(false)

  const createWorkflow = useCallback(async () => {
    if (isCreating) return
    setIsCreating(true)

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        toast.error(tx("toastMsg.pleaseSignInToCreate"))
        setIsCreating(false)
        return
      }

      const resolved = await resolveDefaultProjectId(supabase, user.id)
      if ("error" in resolved) {
        toast.error(tx("toastMsg.couldNotCreateWorkflow", { error: resolved.error }))
        setIsCreating(false)
        return
      }

      const { data: wf, error: wfErr } = await supabase
        .from("workflows")
        .insert({
          project_id: resolved.projectId,
          user_id: user.id,
          name: "Untitled Workflow",
        })
        .select("id, project_id")
        .single()

      if (wfErr || !wf) {
        toast.error(tx("toastMsg.couldNotCreateWorkflow", { error: wfErr?.message ?? tx("run.unknownError") }))
        setIsCreating(false)
        return
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.workflows.all })
      navigate(`/projects/${wf.project_id}/workflows/${wf.id}`)
    } catch (error) {
      // A thrown client error must not leave the button spinning forever.
      toast.error(tx("toastMsg.couldNotCreateWorkflow", { error: error instanceof Error ? error.message : tx("run.unknownError") }))
      setIsCreating(false)
    }
  }, [isCreating, navigate])

  return { createWorkflow, isCreating }
}
