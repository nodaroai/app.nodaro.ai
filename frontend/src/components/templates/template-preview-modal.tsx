import { useState, useEffect, useCallback, useMemo } from "react"
import { createPortal } from "react-dom"
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  BackgroundVariant,
  type Node,
  type Edge,
} from "@xyflow/react"
import { X, Heart, Copy, Layers, Coins, Tag } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  cloneTemplate,
  type TemplateBrowseCard,
} from "@/lib/api"
import { useTemplateDetail } from "@/hooks/queries/use-template-marketplace-queries"
import { nodeTypes } from "@/components/nodes"
import { COMPLEXITY_CONFIG, getNodeTypeLabel, formatCount } from "@/lib/template-utils"
import { APP_CATEGORIES, OUTPUT_TYPE_COLORS, CATEGORY_COLORS } from "@/lib/app-categories"
import "@xyflow/react/dist/style.css"

interface TemplatePreviewModalProps {
  template: TemplateBrowseCard | null
  onClose: () => void
  isFavorited: boolean
  onToggleFavorite: (id: string) => void
  projects: Array<{ id: string; name: string }>
}

function TemplateFlowCanvas({
  nodes,
  edges,
}: {
  nodes: Node[]
  edges: Edge[]
}) {
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      edgesFocusable={false}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#333" />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}

export function TemplatePreviewModal({
  template,
  onClose,
  isFavorited,
  onToggleFavorite,
  projects,
}: TemplatePreviewModalProps) {
  const navigate = useNavigate()
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id ?? "")
  const [isCloning, setIsCloning] = useState(false)

  // Fetch full template detail (with snapshot data)
  const { data: fullTemplate, isLoading: isLoadingDetail } = useTemplateDetail(
    template?.slug ?? null,
  )

  // Reset selected project when projects change
  useEffect(() => {
    if (projects.length > 0 && !selectedProjectId) {
      setSelectedProjectId(projects[0].id)
    }
  }, [projects, selectedProjectId])

  // Escape key handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    },
    [onClose],
  )

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  // Prepare snapshot nodes/edges
  const snapshotNodes = useMemo(
    () => (fullTemplate?.snapshotNodes as Node[] | undefined) ?? [],
    [fullTemplate],
  )

  const snapshotEdges = useMemo(
    () => (fullTemplate?.snapshotEdges as Edge[] | undefined) ?? [],
    [fullTemplate],
  )

  const handleClone = useCallback(async () => {
    if (!template || !selectedProjectId) return
    setIsCloning(true)
    try {
      const result = await cloneTemplate(template.slug, selectedProjectId, template.name)
      toast.success("Template cloned!")
      onClose()
      navigate(`/projects/${result.projectId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clone template")
    } finally {
      setIsCloning(false)
    }
  }, [template, selectedProjectId, navigate, onClose])

  if (!template) return null

  const categoryLabel =
    APP_CATEGORIES.find((c) => c.value === template.category)?.label ?? "Other"
  const categoryColor = CATEGORY_COLORS[template.category] ?? CATEGORY_COLORS.other
  const complexity =
    COMPLEXITY_CONFIG[template.complexity as keyof typeof COMPLEXITY_CONFIG]

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex w-[95vw] h-[90vh] bg-background rounded-xl border border-border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          aria-label="Close preview"
          className="absolute top-3 right-3 z-20 p-1.5 rounded-full bg-background/80 backdrop-blur-sm border border-border hover:bg-accent transition-colors"
          onClick={onClose}
        >
          <X className="w-5 h-5 text-foreground" />
        </button>

        {/* Left: ReactFlow canvas (~60%) */}
        <div className="flex-1 min-w-0 bg-zinc-950 dark:bg-zinc-950 relative">
          {isLoadingDetail ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-8 h-8 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
            </div>
          ) : snapshotNodes.length > 0 ? (
            <ReactFlowProvider>
              <TemplateFlowCanvas nodes={snapshotNodes} edges={snapshotEdges} />
            </ReactFlowProvider>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              No workflow preview available
            </div>
          )}
        </div>

        {/* Right: Info panel (~40%) */}
        <div className="w-[40%] min-w-[340px] max-w-[500px] flex flex-col border-l border-border bg-background">
          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Name */}
            <h2 className="text-xl font-bold text-foreground leading-tight">
              {template.name}
            </h2>

            {/* Creator */}
            {template.creatorDisplayName && (
              <p className="text-xs text-muted-foreground -mt-3">
                by {template.creatorDisplayName}
              </p>
            )}

            {/* Category + output type badges */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={cn(
                  "text-xs px-2 py-0.5 rounded-full font-medium",
                  categoryColor,
                )}
              >
                {categoryLabel}
              </span>
              {template.outputTypes.map((t) => (
                <span
                  key={t}
                  className={cn(
                    "text-xs px-2 py-0.5 rounded-full border font-medium capitalize",
                    OUTPUT_TYPE_COLORS[t] ?? "bg-zinc-500/10 text-zinc-500 border-zinc-500/20",
                  )}
                >
                  {t}
                </span>
              ))}
            </div>

            {/* Stats row */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
              {complexity && (
                <span
                  className={cn(
                    "px-2 py-0.5 rounded border text-xs font-medium",
                    complexity.color,
                  )}
                >
                  {complexity.label}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Layers className="h-3.5 w-3.5" />
                {template.nodeCount} nodes
              </span>
              <span className="flex items-center gap-1">
                <Coins className="h-3.5 w-3.5" />
                {template.estimatedCredits} CR
              </span>
              <span className="flex items-center gap-1">
                <Copy className="h-3.5 w-3.5" />
                {formatCount(template.cloneCount)}
              </span>
              {template.favoriteCount > 0 && (
                <span className="flex items-center gap-1">
                  <Heart className="h-3.5 w-3.5" />
                  {formatCount(template.favoriteCount)}
                </span>
              )}
            </div>

            {/* Short description */}
            {template.description && (
              <p className="text-sm text-muted-foreground leading-relaxed">
                {template.description}
              </p>
            )}

            {/* Markdown description */}
            {fullTemplate?.markdownDescription && (
              <div className="border-t border-border pt-4">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ href, children, ...props }) => (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#ff0073] hover:underline"
                          {...props}
                        >
                          {children}
                        </a>
                      ),
                      code: ({ children, className, ...props }) => {
                        const isInline = !className
                        return isInline ? (
                          <code
                            className="bg-muted px-1 py-0.5 rounded text-xs font-mono"
                            {...props}
                          >
                            {children}
                          </code>
                        ) : (
                          <code
                            className={cn(
                              "block bg-muted p-3 rounded-lg text-xs font-mono overflow-x-auto",
                              className,
                            )}
                            {...props}
                          >
                            {children}
                          </code>
                        )
                      },
                    }}
                  >
                    {fullTemplate.markdownDescription}
                  </Markdown>
                </div>
              </div>
            )}

            {/* Nodes Used */}
            {template.nodeTypesUsed.length > 0 && (
              <div className="border-t border-border pt-4">
                <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
                  Nodes Used
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {template.nodeTypesUsed.map((type) => (
                    <span
                      key={type}
                      className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium"
                    >
                      {getNodeTypeLabel(type)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Providers */}
            {template.providersUsed.length > 0 && (
              <div className="border-t border-border pt-4">
                <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
                  Providers
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {template.providersUsed.map((provider) => (
                    <span
                      key={provider}
                      className="text-xs px-2 py-0.5 rounded-full bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/20 font-medium"
                    >
                      {provider}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Tags */}
            {template.tags.length > 0 && (
              <div className="border-t border-border pt-4">
                <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
                  Tags
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {template.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs px-2 py-0.5 rounded-full bg-[#ff0073]/10 text-[#ff0073] border border-[#ff0073]/20 font-medium"
                    >
                      <Tag className="inline h-3 w-3 mr-0.5 -mt-px" />
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Bottom sticky bar */}
          <div className="border-t border-border p-4 flex items-center gap-3 bg-background">
            {/* Favorite toggle */}
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={() => onToggleFavorite(template.id)}
            >
              <Heart
                className={cn(
                  "h-4 w-4 transition-colors",
                  isFavorited
                    ? "fill-[#ff0073] text-[#ff0073]"
                    : "text-muted-foreground",
                )}
              />
            </Button>

            {/* Project selector */}
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger className="flex-1 min-w-0">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Clone button */}
            <Button
              className="shrink-0 bg-[#ff0073] hover:bg-[#ff0073]/90 text-white"
              disabled={isCloning || !selectedProjectId}
              onClick={handleClone}
            >
              {isCloning ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
              ) : (
                <Copy className="h-4 w-4 mr-2" />
              )}
              Clone to Project
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
