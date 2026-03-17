import { useState, useEffect, useCallback, useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Eye, EyeOff, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { publishTemplate, getMyTemplates, type WorkflowTemplate } from "@/lib/api"
import { APP_CATEGORIES, OUTPUT_TYPES } from "@/lib/app-categories"
import { COMPLEXITY_CONFIG } from "@/lib/template-utils"
import { queryKeys } from "@/lib/query-keys"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"

interface PublishTemplateDialogProps {
  workflowId: string
  nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>
  edges: Array<{ id: string; source: string; target: string }>
  open: boolean
  onOpenChange: (open: boolean) => void
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
}

function computeComplexity(
  nodeCount: number,
  edges: Array<{ source: string }>,
): "simple" | "intermediate" | "advanced" {
  if (nodeCount >= 16) return "advanced"
  // Check for branching: any node has >1 outgoing edge
  const outgoing = new Map<string, number>()
  for (const e of edges) {
    outgoing.set(e.source, (outgoing.get(e.source) ?? 0) + 1)
  }
  const hasBranching = Array.from(outgoing.values()).some((count) => count > 1)
  if (nodeCount >= 6 || hasBranching) return "intermediate"
  return "simple"
}

export function PublishTemplateDialog({
  workflowId,
  nodes,
  edges,
  open,
  onOpenChange,
}: PublishTemplateDialogProps) {
  const queryClient = useQueryClient()

  // Form state
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [markdownDescription, setMarkdownDescription] = useState("")
  const [markdownPreview, setMarkdownPreview] = useState(false)
  const [category, setCategory] = useState("other")
  const [outputTypes, setOutputTypes] = useState<string[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")
  const [isListed, setIsListed] = useState(false)
  const [isUpdate, setIsUpdate] = useState(false)

  // Check for existing template for this workflow
  const { data: myTemplates } = useQuery({
    queryKey: ["my-templates"],
    queryFn: getMyTemplates,
    enabled: open,
    staleTime: 30_000,
  })

  // Pre-fill from existing template when dialog opens
  useEffect(() => {
    if (!open || !myTemplates) return
    const existing = myTemplates.find((t) => t.workflowId === workflowId)
    if (existing) {
      setName(existing.name)
      setDescription(existing.description ?? "")
      setMarkdownDescription(existing.markdownDescription ?? "")
      setCategory(existing.category || "other")
      setOutputTypes(existing.outputTypes ?? [])
      setTags(existing.tags ?? [])
      setIsListed(existing.isListed)
      setIsUpdate(true)
    } else {
      setName("")
      setDescription("")
      setMarkdownDescription("")
      setCategory("other")
      setOutputTypes([])
      setTags([])
      setIsListed(false)
      setIsUpdate(false)
    }
    setMarkdownPreview(false)
    setTagInput("")
  }, [open, myTemplates, workflowId])

  // Computed read-only info
  const nodeCount = nodes.length
  const complexity = useMemo(
    () => computeComplexity(nodeCount, edges),
    [nodeCount, edges],
  )
  const complexityConfig = COMPLEXITY_CONFIG[complexity]

  const detectedNodeTypes = useMemo(() => {
    const typeSet = new Set<string>()
    for (const n of nodes) {
      if (n.type) typeSet.add(n.type)
    }
    return Array.from(typeSet).sort()
  }, [nodes])

  const detectedProviders = useMemo(() => {
    const providerSet = new Set<string>()
    for (const n of nodes) {
      const provider = n.data?.provider as string | undefined
      if (provider) providerSet.add(provider)
    }
    return Array.from(providerSet).sort()
  }, [nodes])

  // Auto-generated slug preview
  const slugPreview = useMemo(() => {
    if (!name.trim()) return ""
    return slugify(name)
  }, [name])

  // Publish mutation
  const mutation = useMutation({
    mutationFn: (data: Parameters<typeof publishTemplate>[0]) =>
      publishTemplate(data),
    onSuccess: () => {
      toast.success("Template published!")
      queryClient.invalidateQueries({ queryKey: queryKeys.templateMarketplace.all })
      queryClient.invalidateQueries({ queryKey: ["my-templates"] })
      onOpenChange(false)
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to publish template")
    },
  })

  const handleSubmit = useCallback(() => {
    if (!name.trim()) {
      toast.error("Name is required")
      return
    }
    mutation.mutate({
      workflowId,
      name: name.trim(),
      description: description.trim() || undefined,
      markdownDescription: markdownDescription.trim() || undefined,
      category: category !== "other" ? category : undefined,
      outputTypes: outputTypes.length > 0 ? outputTypes : undefined,
      tags: tags.length > 0 ? tags : undefined,
      isListed,
    })
  }, [workflowId, name, description, markdownDescription, category, outputTypes, tags, isListed, mutation])

  // Tag handling
  const handleAddTag = useCallback(() => {
    const trimmed = tagInput.trim().toLowerCase()
    if (!trimmed || tags.includes(trimmed) || tags.length >= 10) return
    setTags([...tags, trimmed])
    setTagInput("")
  }, [tagInput, tags])

  const handleRemoveTag = useCallback(
    (tag: string) => {
      setTags(tags.filter((t) => t !== tag))
    },
    [tags],
  )

  const handleToggleOutputType = useCallback((type: string) => {
    setOutputTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    )
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isUpdate ? "Update Template" : "Publish as Template"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Publish this workflow as a reusable template on the marketplace.
          </p>

          {/* Name */}
          <div>
            <label className="text-sm font-medium mb-1 block">Name *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 100))}
              placeholder="My Awesome Workflow"
              maxLength={100}
            />
            {slugPreview && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Slug: <span className="font-mono">{slugPreview}</span>
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium mb-1 block">Short Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 500))}
              placeholder="Short description for card display"
              maxLength={500}
            />
          </div>

          {/* Markdown Description */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium">Full Description</label>
              <button
                type="button"
                onClick={() => setMarkdownPreview(!markdownPreview)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {markdownPreview ? (
                  <><EyeOff className="h-3.5 w-3.5" />Edit</>
                ) : (
                  <><Eye className="h-3.5 w-3.5" />Preview</>
                )}
              </button>
            </div>
            {markdownPreview ? (
              <div className="rounded-lg border border-border p-3 min-h-[150px] max-h-[300px] overflow-y-auto prose prose-sm dark:prose-invert max-w-none">
                {markdownDescription.trim() ? (
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
                    }}
                  >
                    {markdownDescription}
                  </Markdown>
                ) : (
                  <p className="text-muted-foreground italic text-sm">Nothing to preview</p>
                )}
              </div>
            ) : (
              <textarea
                value={markdownDescription}
                onChange={(e) => setMarkdownDescription(e.target.value)}
                placeholder="Detailed description (supports Markdown)..."
                rows={6}
                className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
              />
            )}
          </div>

          {/* Category */}
          <div>
            <label className="text-sm font-medium mb-1 block">Category</label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-full h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APP_CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Output Types */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Output types</label>
            <div className="flex items-center gap-2 flex-wrap">
              {OUTPUT_TYPES.map((ot) => (
                <label
                  key={ot.value}
                  className={cn(
                    "flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border cursor-pointer transition-colors",
                    outputTypes.includes(ot.value)
                      ? "bg-[#ff0073]/10 text-[#ff0073] border-[#ff0073]/30"
                      : "text-muted-foreground border-border hover:border-zinc-400",
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={outputTypes.includes(ot.value)}
                    onChange={() => handleToggleOutputType(ot.value)}
                  />
                  {ot.label}
                </label>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">
              Tags{" "}
              <span className="text-xs text-muted-foreground font-normal">
                ({tags.length}/10)
              </span>
            </label>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 text-[11px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-1.5">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="Add a tag..."
                className="h-8 text-xs flex-1"
                maxLength={30}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    handleAddTag()
                  }
                }}
                disabled={tags.length >= 10}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={handleAddTag}
                disabled={!tagInput.trim() || tags.length >= 10}
              >
                Add
              </Button>
            </div>
          </div>

          {/* List on marketplace toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">List on marketplace</p>
              <p className="text-xs text-muted-foreground">
                Make discoverable on the Templates browse page
              </p>
            </div>
            <Switch checked={isListed} onCheckedChange={setIsListed} />
          </div>

          {/* Computed info section */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2.5">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Workflow Info
            </h4>

            <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
              <span>{nodeCount} node{nodeCount !== 1 ? "s" : ""}</span>
              <span
                className={cn(
                  "px-2 py-0.5 rounded border text-xs font-medium",
                  complexityConfig.color,
                )}
              >
                {complexityConfig.label}
              </span>
              <span className="italic">Credits: auto-calculated on publish</span>
            </div>

            {detectedNodeTypes.length > 0 && (
              <div>
                <p className="text-[11px] text-muted-foreground mb-1 font-medium">
                  Detected node types
                </p>
                <div className="flex flex-wrap gap-1">
                  {detectedNodeTypes.map((type) => (
                    <span
                      key={type}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium"
                    >
                      {type}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {detectedProviders.length > 0 && (
              <div>
                <p className="text-[11px] text-muted-foreground mb-1 font-medium">
                  Detected providers
                </p>
                <div className="flex flex-wrap gap-1">
                  {detectedProviders.map((provider) => (
                    <span
                      key={provider}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/20 font-medium"
                    >
                      {provider}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Submit button */}
          <Button
            onClick={handleSubmit}
            disabled={mutation.isPending || !name.trim()}
            className="w-full text-white hover:opacity-90"
            style={{ backgroundColor: "#ff0073" }}
          >
            {mutation.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            {isUpdate ? "Update Template" : "Publish Template"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
