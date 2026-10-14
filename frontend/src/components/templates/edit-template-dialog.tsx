import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { TEMPLATE_CATEGORIES, normalizeTemplateCategory } from "@nodaro/shared/apps"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { updateTemplate, type WorkflowTemplate } from "@/lib/api"
import { OUTPUT_TYPES, outputTypeLabel } from "@/lib/app-categories"
import { templateCategoryLabel } from "@/lib/template-categories"
import { queryKeys } from "@/lib/query-keys"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

interface Draft {
  readonly name: string
  readonly description: string
  readonly markdownDescription: string
  readonly category: string
  readonly outputTypes: readonly string[]
  readonly isListed: boolean
}

function draftOf(template: WorkflowTemplate): Draft {
  return {
    name: template.name,
    description: template.description ?? "",
    markdownDescription: template.markdownDescription ?? "",
    category: normalizeTemplateCategory(template.category),
    outputTypes: template.outputTypes,
    isListed: template.isListed,
  }
}

const FIELD = "w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"

/**
 * Edit a published template's details — name, the two descriptions, use
 * case, output types, listing — from My Templates, without the workflow it
 * was published from. The snapshot stays as published; re-publishing from
 * the source workflow is the only way to change that.
 */
export function EditTemplateDialog({
  template,
  open,
  onOpenChange,
}: {
  readonly template: WorkflowTemplate | null
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)
  useEffect(() => {
    if (open && template) setDraft(draftOf(template))
  }, [open, template])
  const patch = (changes: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...changes } : current))

  const mutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Draft }) =>
      updateTemplate(id, {
        name: values.name.trim(),
        description: values.description.trim(),
        markdownDescription: values.markdownDescription.trim(),
        category: values.category,
        outputTypes: values.outputTypes,
        isListed: values.isListed,
      }),
    onSuccess: () => {
      toast.success(t("templates.updated"))
      queryClient.invalidateQueries({ queryKey: ["my-templates"] })
      queryClient.invalidateQueries({ queryKey: queryKeys.templateMarketplace.all })
      onOpenChange(false)
    },
    onError: (err: Error) => toast.error(err.message || t("templates.failedUpdate")),
  })

  const canSave = draft !== null && draft.name.trim().length > 0 && !mutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("templates.editDetails")}</DialogTitle>
          <DialogDescription>{template?.name ?? ""}</DialogDescription>
        </DialogHeader>

        {draft && template && (
          <div className="space-y-4">
            <div>
              <label htmlFor="edit-template-name" className="mb-1 block text-sm font-medium">
                {t("pubTemplate.nameLabel")}
              </label>
              <Input id="edit-template-name" value={draft.name} onChange={(e) => patch({ name: e.target.value })} maxLength={100} />
            </div>

            <div>
              <label htmlFor="edit-template-short" className="mb-1 block text-sm font-medium">
                {t("pubTemplate.shortDescLabel")}
              </label>
              <Input
                id="edit-template-short"
                value={draft.description}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder={t("pubTemplate.shortDescPlaceholder")}
                maxLength={500}
              />
            </div>

            <div>
              <label htmlFor="edit-template-full" className="mb-1 block text-sm font-medium">
                {t("pubTemplate.fullDescLabel")}
              </label>
              <textarea
                id="edit-template-full"
                value={draft.markdownDescription}
                onChange={(e) => patch({ markdownDescription: e.target.value })}
                placeholder={t("pubTemplate.markdownPlaceholder")}
                rows={8}
                maxLength={5000}
                className={cn(FIELD, "resize-y")}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">{t("pubTemplate.categoryLabel")}</label>
              <Select value={draft.category} onValueChange={(category) => patch({ category })}>
                <SelectTrigger className="h-9 w-full text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_CATEGORIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {templateCategoryLabel(value, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("pubTemplate.outputTypesLabel")}</label>
              <div className="flex flex-wrap items-center gap-2">
                {OUTPUT_TYPES.map((type) => {
                  const on = draft.outputTypes.includes(type.value)
                  return (
                    <label
                      key={type.value}
                      className={cn(
                        "flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                        on ? "border-[#ff0073]/30 bg-[#ff0073]/10 text-[#ff0073]" : "border-border text-muted-foreground hover:border-zinc-400",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={on}
                        onChange={() =>
                          patch({
                            outputTypes: on ? draft.outputTypes.filter((v) => v !== type.value) : [...draft.outputTypes, type.value],
                          })
                        }
                      />
                      {outputTypeLabel(type.value, t)}
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{t("pubTemplate.listOnMarketplace")}</div>
                <div className="text-xs text-muted-foreground">{t("pubTemplate.listOnMarketplaceDesc")}</div>
              </div>
              <Switch checked={draft.isListed} onCheckedChange={(isListed) => patch({ isListed })} />
            </div>

            <p className="text-xs text-muted-foreground">{t("templates.openWorkflowHint")}</p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => draft && template && mutation.mutate({ id: template.id, values: draft })} disabled={!canSave}>
            {mutation.isPending && <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />}
            {t("templates.saveChanges")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
