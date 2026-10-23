import { LayoutTemplate, Heart, Trash2, ToggleLeft, ToggleRight, Loader2, Layers, Copy, Pencil, ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import type { WorkflowTemplate } from "@/lib/api"
import { COMPLEXITY_CONFIG, type Complexity } from "@/lib/template-utils"
import { useOpenSourceWorkflow } from "./use-open-source-workflow"

/** The creator's own templates: edit details, list/unlist and delete, no browsing. */
export function MyTemplatesGrid({
  templates,
  onEdit,
  onToggleListed,
  onDelete,
  isDeleting,
}: {
  templates: WorkflowTemplate[] | undefined
  onEdit: (template: WorkflowTemplate) => void
  onToggleListed: (templateId: string, isListed: boolean) => void
  onDelete: (templateId: string) => void
  isDeleting: boolean
}) {
  const t = useT()
  if (!templates || templates.length === 0) {
    return (
      <div className="text-center py-16">
        <LayoutTemplate className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-foreground mb-2">{t("templates.emptyMyTitle")}</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          {t("templates.emptyMyDesc")}
        </p>
      </div>
    )
  }

  return (
    // Intentionally NOT row-virtualized (Batch E): variable-height cards +
    // only 20/page make windowing low-payoff here.
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {templates.map((tmpl) => (
        <MyTemplateCard
          key={tmpl.id}
          template={tmpl}
          onEdit={() => onEdit(tmpl)}
          onToggleListed={(isListed) => onToggleListed(tmpl.id, isListed)}
          onDelete={() => onDelete(tmpl.id)}
          isDeleting={isDeleting}
        />
      ))}
    </div>
  )
}

function MyTemplateCard({
  template,
  onEdit,
  onToggleListed,
  onDelete,
  isDeleting,
}: {
  template: WorkflowTemplate
  onEdit: () => void
  onToggleListed: (isListed: boolean) => void
  onDelete: () => void
  isDeleting: boolean
}) {
  const t = useT()
  const complexity = COMPLEXITY_CONFIG[template.complexity as Complexity]
  const source = useOpenSourceWorkflow()
  const opening = source.openingId === template.workflowId

  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:border-border/80 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate"><span dir="auto">{template.name}</span></h3>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{template.slug}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ms-2">
          {/* Listed/Unlisted badge */}
          <button
            type="button"
            className={cn(
              "text-[11px] px-2 py-0.5 rounded-full transition-colors",
              template.isListed
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
                : "bg-zinc-100 dark:bg-zinc-800 text-muted-foreground hover:bg-zinc-200 dark:hover:bg-zinc-700",
            )}
            onClick={() => onToggleListed(!template.isListed)}
            title={template.isListed ? t("templates.clickToUnlist") : t("templates.clickToList")}
          >
            {template.isListed ? t("templates.listed") : t("templates.unlisted")}
          </button>
          {/* Complexity badge */}
          {complexity && (
            <span className={cn("text-[11px] px-2 py-0.5 rounded-full border font-medium", complexity.color)}>
              {complexity.label}
            </span>
          )}
        </div>
      </div>

      {template.description && (
        <p dir="auto" className="text-xs text-muted-foreground mb-3 line-clamp-2">{template.description}</p>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-4 mb-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Copy className="h-3 w-3" />
          {t("templates.clones", { n: template.cloneCount })}
        </span>
        <span className="flex items-center gap-1">
          <Heart className="h-3 w-3" />
          {t("templates.favorites", { n: template.favoriteCount })}
        </span>
        <span className="flex items-center gap-1">
          <Layers className="h-3 w-3" />
          {t("templates.nodes", { n: template.nodeCount })}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          {t("templates.editDetails")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => source.open(template.workflowId)}
          disabled={opening}
          title={t("templates.openWorkflowHint")}
        >
          {opening ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />}
          {t("templates.openWorkflow")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => onToggleListed(!template.isListed)}
          title={template.isListed ? t("templates.unlist") : t("templates.list")}
        >
          {template.isListed ? (
            <ToggleRight className="h-4 w-4 text-emerald-500" />
          ) : (
            <ToggleLeft className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          onClick={onDelete}
          disabled={isDeleting}
          title={t("templates.deleteTemplate")}
        >
          {isDeleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  )
}
