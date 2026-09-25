import { useCallback, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { importWorkflow } from "@/lib/api"
import { resolveDefaultProjectId } from "@/lib/default-project"
import { useT } from "@/lib/i18n"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { createClient } from "@/lib/supabase"
import {
  bundledAssetCount,
  describeMediaRefNodes,
  parseWorkflowJson,
  readFileAsText,
  toWorkflowExportPayload,
} from "@/lib/workflow-import"

/**
 * Import a workflow JSON file from the home screen: parse it, land it in the
 * caller's default project, and open it.
 *
 * The sibling of {@link import("./use-create-workflow").useCreateWorkflow} —
 * same default-project resolution, same navigate-on-success, so the two buttons
 * that sit beside each other behave alike. It deliberately goes through
 * `POST /v1/workflows/import` rather than inserting a row: that route is what
 * re-creates the bundle's characters, objects and locations under this user,
 * re-points the nodes at the new rows and rehosts reachable media. An insert
 * would land a workflow whose entity chips point at another account's ids.
 *
 * There is no "add to the open canvas" choice here, unlike the editor toolbar:
 * on this screen there is no canvas to add to, so the file always becomes a new
 * workflow.
 */
export function useImportWorkflowJson(): {
  readonly importFile: (file: File) => Promise<void>
  readonly isImporting: boolean
} {
  const t = useT()
  const navigate = useNavigate()
  const [isImporting, setIsImporting] = useState(false)

  const importFile = useCallback(
    async (file: File) => {
      if (isImporting) return
      setIsImporting(true)
      try {
        // Parsing first: a file that is not a workflow should say so before we
        // lazy-create anybody's default project on its behalf.
        const data = parseWorkflowJson(await readFileAsText(file))

        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) {
          toast.error(t("dash.importSignIn"))
          return
        }

        const resolved = await resolveDefaultProjectId(supabase, user.id)
        if ("error" in resolved) {
          toast.error(t("editor.importFailed", { error: resolved.error }))
          return
        }

        const created = await importWorkflow({
          ...toWorkflowExportPayload(data),
          projectId: resolved.projectId,
        })

        const assetCount = bundledAssetCount(data)
        const report = created.importReport
        const copied = report?.rehosted
          ? t(report.rehosted === 1 ? "editor.mediaCopiedOne" : "editor.mediaCopiedMany", { n: report.rehosted })
          : ""
        toast.success(
          (assetCount > 0 ? t("editor.importedWithAssetsCount", { n: assetCount }) : t("editor.importedPlain")) + copied,
        )

        // Media this instance could not fetch stays pointing at the exporter,
        // and those nodes will not run until it is re-uploaded here (#866).
        const unreachable = report?.unreachable ?? []
        if (unreachable.length > 0) {
          const n = unreachable.length
          toast.warning(
            t(n === 1 ? "editor.unreachableImportWarnOne" : "editor.unreachableImportWarnMany", {
              n,
              refs: describeMediaRefNodes(unreachable),
            }),
            { duration: 12_000 },
          )
        }

        queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
        queryClient.invalidateQueries({ queryKey: queryKeys.workflows.all })
        navigate(`/projects/${created.projectId}/workflows/${created.id}`)
      } catch (err) {
        // One catch for both halves, but they are different failures and read
        // differently: a parse error names the file, everything else names the
        // import.
        const message = err instanceof Error ? err.message : t("editor.couldNotParseJson")
        toast.error(
          err instanceof SyntaxError || /Missing (nodes|edges) array/.test(message)
            ? t("editor.invalidFile", { error: message })
            : t("editor.importFailed", { error: message }),
        )
      } finally {
        // Unlike the create path this always clears: the import can fail after
        // a long upload, and the button has to come back.
        setIsImporting(false)
      }
    },
    [isImporting, navigate, t],
  )

  return { importFile, isImporting }
}
