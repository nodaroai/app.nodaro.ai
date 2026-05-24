import { useState, useEffect } from "react"
import {
  Loader2, Globe, Lock, RotateCcw, FileText, Save, Info,
  Pencil, X, Download, Upload, Key, ChevronRight, LayoutList,
  Plus, Trash2, Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { hasAdmin } from "@/lib/edition"
import { toast } from "sonner"
import { Link } from "react-router-dom"
import {
  SYSTEM_PROMPT_TEMPLATES,
  TEMPLATE_GROUPS,
  WRAPPER_TEMPLATE_KEY,
} from "@/lib/prompt-templates"
import { useUserSettings, useUpdatePublicOutputsMutation, useSaveTemplatesMutation, useUpdateNodeMenuPrefsMutation } from "@/hooks/queries/use-user-settings-queries"
import type { GenerateTextTemplate } from "@/lib/generate-text-templates"
import { LlmModelSelect } from "@/components/editor/config-panels/llm-model-select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { clearMemory } from "@/lib/node-defaults"

const PRIVATE_MODE_TIERS = new Set(["standard", "pro", "business"])

const VALID_TEMPLATE_KEYS = new Set(Object.keys(SYSTEM_PROMPT_TEMPLATES))

export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth()
  const [localTemplates, setLocalTemplates] = useState<Record<string, string>>({})
  const [savedTemplates, setSavedTemplates] = useState<Record<string, string>>({})
  const [editingKey, setEditingKey] = useState<string | null>(null)

  // Generate Text user templates (profiles.text_templates). Local working copy +
  // last-saved snapshot so we can compute dirtiness, mirroring promptTemplates.
  const [textTemplates, setTextTemplates] = useState<GenerateTextTemplate[]>([])
  const [savedTextTemplates, setSavedTextTemplates] = useState<GenerateTextTemplate[]>([])
  const [editingTextId, setEditingTextId] = useState<string | null>(null)

  const { data: settings, isLoading: settingsLoading, isError: settingsError, refetch: refetchSettings } = useUserSettings(user?.id)
  const toggleMutation = useUpdatePublicOutputsMutation()
  const templatesMutation = useSaveTemplatesMutation()
  const nodeMenuMutation = useUpdateNodeMenuPrefsMutation()

  const publicOutputs = settings?.publicOutputs ?? true
  const tier = settings?.tier ?? "free"
  const showRecentNodes = settings?.showRecentNodes ?? false
  const showMostUsedNodes = settings?.showMostUsedNodes ?? false

  useEffect(() => {
    if (settings?.promptTemplates) {
      setLocalTemplates(settings.promptTemplates)
      setSavedTemplates(settings.promptTemplates)
    }
  }, [settings?.promptTemplates])

  useEffect(() => {
    if (settings?.textTemplates) {
      setTextTemplates(settings.textTemplates)
      setSavedTextTemplates(settings.textTemplates)
    }
  }, [settings?.textTemplates])

  async function handleToggle() {
    if (!user?.id) return
    try {
      await toggleMutation.mutateAsync({ userId: user.id, publicOutputs: !publicOutputs })
      toast.success(!publicOutputs ? "Outputs are now public" : "Outputs are now private")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update"
      toast.error(message)
    }
  }

  async function handleToggleRecent(next: boolean) {
    if (!user?.id) return
    try {
      await nodeMenuMutation.mutateAsync({ userId: user.id, showRecentNodes: next })
      toast.success(next ? "Recent category shown" : "Recent category hidden")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update")
    }
  }

  async function handleToggleMostUsed(next: boolean) {
    if (!user?.id) return
    try {
      await nodeMenuMutation.mutateAsync({ userId: user.id, showMostUsedNodes: next })
      toast.success(next ? "Most Used category shown" : "Most Used category hidden")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update")
    }
  }

  function handleTemplateChange(key: string, value: string) {
    setLocalTemplates((prev) => {
      const next = { ...prev }
      if (value.trim() === "") {
        delete next[key]
      } else {
        next[key] = value
      }
      return next
    })
  }

  function handleResetTemplate(key: string) {
    setLocalTemplates((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  async function handleSaveTemplates() {
    if (!user?.id) return
    try {
      await templatesMutation.mutateAsync({ userId: user.id, promptTemplates: localTemplates })
      setEditingKey(null)
      toast.success("Prompt templates saved")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save"
      toast.error(message)
    }
  }

  // --- Generate Text templates ---

  function handleAddTextTemplate() {
    const id = crypto.randomUUID()
    setTextTemplates((prev) => [...prev, { id, label: "New Template", systemPrompt: "" }])
    setEditingTextId(id)
  }

  function handleTextTemplateChange(id: string, patch: Partial<GenerateTextTemplate>) {
    setTextTemplates((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    )
  }

  function handleDeleteTextTemplate(id: string) {
    setTextTemplates((prev) => prev.filter((t) => t.id !== id))
    if (editingTextId === id) setEditingTextId(null)
  }

  async function handleSaveTextTemplates() {
    if (!user?.id) return
    // Drop blank entries (no label or no system prompt) so empty rows aren't
    // persisted. Also drop an out-of-range maxTokens (backend Zod requires
    // 1..16384) so a partially-typed value can't 400 the whole save.
    const cleaned = textTemplates
      .map((t) => {
        const maxTokensValid =
          t.defaultMaxTokens != null &&
          Number.isInteger(t.defaultMaxTokens) &&
          t.defaultMaxTokens >= 1 &&
          t.defaultMaxTokens <= 16384
        return {
          ...t,
          label: t.label.trim(),
          systemPrompt: t.systemPrompt.trim(),
          ...(maxTokensValid ? {} : { defaultMaxTokens: undefined }),
        }
      })
      .filter((t) => t.label.length > 0 && t.systemPrompt.length > 0)
    try {
      // Re-send the already-saved prompt templates so this PATCH doesn't clobber
      // them (the backend updates prompt_templates whenever the field is present).
      await templatesMutation.mutateAsync({
        userId: user.id,
        promptTemplates: savedTemplates,
        textTemplates: cleaned,
      })
      setTextTemplates(cleaned)
      setSavedTextTemplates(cleaned)
      setEditingTextId(null)
      toast.success("Generate Text templates saved")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save"
      toast.error(message)
    }
  }

  function handleExport() {
    const hasOverrides = Object.keys(localTemplates).length > 0
    const data = hasOverrides
      ? localTemplates
      : {
          _note: "These are system defaults. Edit the values you want to customize.",
          ...Object.fromEntries(
            Object.entries(SYSTEM_PROMPT_TEMPLATES).map(([k, v]) => [k, v.template]),
          ),
        }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "nodaro-prompt-templates.json"
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImport() {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".json"
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const parsed: unknown = JSON.parse(text)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Expected a JSON object")
        }
        const imported: Record<string, string> = {}
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (VALID_TEMPLATE_KEYS.has(k) && typeof v === "string") {
            imported[k] = v
          }
        }
        if (Object.keys(imported).length === 0) {
          toast.error("No valid template overrides found in file")
          return
        }
        setLocalTemplates(imported)
        toast.success(`Imported ${Object.keys(imported).length} template overrides`)
      } catch {
        toast.error("Invalid template file")
      }
    }
    input.click()
  }

  function handleResetAll() {
    const confirmed = window.confirm(
      "Are you sure? This will remove all your custom templates and restore system defaults.",
    )
    if (!confirmed) return
    setLocalTemplates({})
    setEditingKey(null)
  }

  const hasAnyOverride = Object.keys(localTemplates).length > 0

  const hasTemplateChanges = JSON.stringify(localTemplates) !== JSON.stringify(savedTemplates)

  const hasTextTemplateChanges = JSON.stringify(textTemplates) !== JSON.stringify(savedTextTemplates)

  const canToggle = PRIVATE_MODE_TIERS.has(tier)

  if (authLoading || settingsLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (settingsError) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">Settings</h1>
        <div className="rounded-lg border border-red-300 dark:border-red-800 bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground mb-4">
            We couldn&apos;t load your settings. Please try again.
          </p>
          <Button variant="outline" size="sm" onClick={() => refetchSettings()}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      {/* Gallery Visibility */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {publicOutputs ? (
                <Globe className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Lock className="h-4 w-4 text-muted-foreground" />
              )}
              <h2 className="text-base font-semibold">Gallery Visibility</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {publicOutputs
                ? "New AI-generated outputs will appear in the public gallery by default."
                : "New outputs will be private by default. This does not change existing items."}
            </p>
          </div>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canToggle || toggleMutation.isPending}
                    onClick={handleToggle}
                    className={cn(
                      "min-w-[100px]",
                      !publicOutputs && canToggle && "border-[#ff0073] text-[#ff0073]",
                    )}
                  >
                    {toggleMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : publicOutputs ? (
                      "Make Private"
                    ) : (
                      "Make Public"
                    )}
                  </Button>
                </span>
              </TooltipTrigger>
              {!canToggle && (
                <TooltipContent>
                  Available on Standard plan and above
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* API Tokens */}
      {hasAdmin() && (
        <Link
          to="/settings/api"
          className="mt-6 flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-6 hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Key className="h-5 w-5 text-muted-foreground" />
            <div>
              <h2 className="text-base font-semibold">API Tokens</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Create tokens to execute workflows programmatically via REST API.
              </p>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </Link>
      )}

      {/* Defaults — reset remembered AI node selections */}
      <div className="mt-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-semibold">Defaults</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              When you create a new AI node, Nodaro remembers your last selection so you don&apos;t have to choose every time. Resetting clears all remembered selections.
            </p>
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={!user?.id}>
                Reset to defaults
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset all remembered defaults?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will erase your remembered model and parameter choices for every AI node type. Existing nodes on your canvases are not affected. New nodes will start from the admin defaults.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (!user?.id) return
                    clearMemory(user.id)
                    toast.success("Remembered defaults cleared")
                  }}
                >
                  Reset
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Add Node Menu */}
      <div className="mt-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-6">
        <div className="flex items-center gap-2 mb-1">
          <LayoutList className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Add Node Menu</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Choose which shortcut categories appear at the top of the Add Node menu in the editor.
        </p>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <label htmlFor="show-recent" className="text-sm font-medium">Recent</label>
              <p className="text-xs text-muted-foreground mt-0.5">Nodes you added most recently.</p>
            </div>
            <Switch
              id="show-recent"
              checked={showRecentNodes}
              disabled={!user?.id}
              onCheckedChange={handleToggleRecent}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <label htmlFor="show-most-used" className="text-sm font-medium">Most Used</label>
              <p className="text-xs text-muted-foreground mt-0.5">Nodes you add the most often.</p>
            </div>
            <Switch
              id="show-most-used"
              checked={showMostUsedNodes}
              disabled={!user?.id}
              onCheckedChange={handleToggleMostUsed}
            />
          </div>
        </div>
      </div>

      {/* Prompt Templates */}
      <div className="mt-8">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-bold">Prompt Templates</h2>

          <div className="flex items-center gap-1 ml-auto">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={handleExport} aria-label="Export templates">
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Export templates as JSON</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={handleImport} aria-label="Import templates">
                    <Upload className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Import templates from JSON</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {hasAnyOverride && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0 border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
                      onClick={handleResetAll}
                      aria-label="Reset all templates"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Reset all templates to defaults</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Customize the prompts used when generating images from asset nodes.
          Click the edit button to modify a template.
        </p>

        {/* Asset type groups */}
        <div className="space-y-4 mb-6">
          {TEMPLATE_GROUPS.map((group) => (
            <TemplateGroupCard
              key={group.name}
              name={group.name}
              descriptionKey={group.descriptionKey}
              generationKey={group.generationKey}
              templates={localTemplates}
              editingKey={editingKey}
              onStartEdit={setEditingKey}
              onCancelEdit={() => setEditingKey(null)}
              onChange={handleTemplateChange}
              onReset={handleResetTemplate}
            />
          ))}

          {/* Standalone: Generate Image Wrapper */}
          <TemplateCard
            templateKey={WRAPPER_TEMPLATE_KEY}
            value={localTemplates[WRAPPER_TEMPLATE_KEY] ?? ""}
            isEditing={editingKey === WRAPPER_TEMPLATE_KEY}
            onStartEdit={() => setEditingKey(WRAPPER_TEMPLATE_KEY)}
            onCancelEdit={() => setEditingKey(null)}
            onChange={handleTemplateChange}
            onReset={handleResetTemplate}
          />
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button
            onClick={handleSaveTemplates}
            disabled={templatesMutation.isPending || !hasTemplateChanges}
            className="bg-[#ff0073] hover:bg-[#e00067] text-white"
          >
            {templatesMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Templates
          </Button>
        </div>
      </div>

      {/* Generate Text Templates (user-defined presets for the Generate Text node) */}
      <div className="mt-8">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-bold">Generate Text Templates</h2>
          <Button
            variant="outline"
            size="sm"
            className="h-8 ml-auto"
            onClick={handleAddTextTemplate}
            disabled={!user?.id}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Template
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Save reusable system prompts for the Generate Text node. Each template
          appears under &ldquo;My Templates&rdquo; when you configure a Generate Text node.
        </p>

        <div className="space-y-4 mb-6">
          {textTemplates.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 bg-card p-6 text-center">
              <p className="text-sm text-muted-foreground">
                No templates yet. Click &ldquo;Add Template&rdquo; to create one.
              </p>
            </div>
          ) : (
            textTemplates.map((template) => (
              <TextTemplateCard
                key={template.id}
                template={template}
                isEditing={editingTextId === template.id}
                onStartEdit={() => setEditingTextId(template.id)}
                onCancelEdit={() => setEditingTextId(null)}
                onChange={handleTextTemplateChange}
                onDelete={handleDeleteTextTemplate}
              />
            ))
          )}
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button
            onClick={handleSaveTextTemplates}
            disabled={templatesMutation.isPending || !hasTextTemplateChanges}
            className="bg-[#ff0073] hover:bg-[#e00067] text-white"
          >
            {templatesMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Templates
          </Button>
        </div>
      </div>
    </div>
  )
}

function TextTemplateCard({
  template,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onChange,
  onDelete,
}: {
  readonly template: GenerateTextTemplate
  readonly isEditing: boolean
  readonly onStartEdit: () => void
  readonly onCancelEdit: () => void
  readonly onChange: (id: string, patch: Partial<GenerateTextTemplate>) => void
  readonly onDelete: (id: string) => void
}) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input
              type="text"
              value={template.label}
              placeholder="Template name"
              onChange={(e) => onChange(template.id, { label: e.target.value })}
              className={cn(
                "w-full rounded-md border px-2 py-1 text-sm font-semibold",
                "bg-transparent placeholder:text-muted-foreground/50",
                "border-zinc-200 dark:border-zinc-700",
                "focus:outline-none focus:ring-2 focus:ring-[#ff0073]/30 focus:border-[#ff0073]",
              )}
              autoFocus
            />
          ) : (
            <h4 className="text-sm font-semibold truncate">{template.label || "Untitled"}</h4>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {isEditing ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={onCancelEdit}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Done
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={onStartEdit}
            >
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Edit
            </Button>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                  onClick={() => onDelete(template.id)}
                  aria-label="Delete template"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete template</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {isEditing ? (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">System Prompt</label>
            <textarea
              rows={4}
              value={template.systemPrompt}
              placeholder="You are a helpful assistant that…"
              onChange={(e) => onChange(template.id, { systemPrompt: e.target.value })}
              className={cn(
                "mt-1 w-full rounded-md border px-3 py-2 text-sm font-mono resize-y",
                "bg-transparent placeholder:text-muted-foreground/50",
                "border-zinc-200 dark:border-zinc-700",
                "focus:outline-none focus:ring-2 focus:ring-[#ff0073]/30 focus:border-[#ff0073]",
              )}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Max Tokens (optional)</label>
              <input
                type="number"
                min={1}
                max={16384}
                value={template.defaultMaxTokens ?? ""}
                placeholder="e.g. 4096"
                onChange={(e) => {
                  const v = e.target.value.trim()
                  onChange(template.id, { defaultMaxTokens: v === "" ? undefined : Number(v) })
                }}
                className={cn(
                  "mt-1 w-full rounded-md border px-2 py-1 text-sm",
                  "bg-transparent placeholder:text-muted-foreground/50",
                  "border-zinc-200 dark:border-zinc-700",
                  "focus:outline-none focus:ring-2 focus:ring-[#ff0073]/30 focus:border-[#ff0073]",
                )}
              />
            </div>
            <LlmModelSelect
              feature="llm-chat"
              value={template.llmModel}
              onChange={(modelId) => onChange(template.id, { llmModel: modelId })}
            />
          </div>
        </div>
      ) : (
        <p className="text-xs font-mono leading-relaxed whitespace-pre-wrap text-muted-foreground line-clamp-3">
          {template.systemPrompt || "No system prompt set."}
        </p>
      )}
    </div>
  )
}

type TemplateTab = "description" | "generation"

function TemplateGroupCard({
  name,
  descriptionKey,
  generationKey,
  templates,
  editingKey,
  onStartEdit,
  onCancelEdit,
  onChange,
  onReset,
}: {
  readonly name: string
  readonly descriptionKey: string
  readonly generationKey: string
  readonly templates: Record<string, string>
  readonly editingKey: string | null
  readonly onStartEdit: (key: string) => void
  readonly onCancelEdit: () => void
  readonly onChange: (key: string, value: string) => void
  readonly onReset: (key: string) => void
}) {
  const [tab, setTab] = useState<TemplateTab>("description")

  const activeKey = tab === "description" ? descriptionKey : generationKey
  const info = SYSTEM_PROMPT_TEMPLATES[activeKey]
  if (!info) return null

  const value = templates[activeKey] ?? ""
  const hasOverride = value.trim().length > 0
  const displayText = hasOverride ? value : info.template
  const isEditing = editingKey === activeKey

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-4">
      {/* Header: title + info tooltip */}
      <div className="flex items-center gap-2 mb-3">
        <h4 className="text-sm font-semibold">{name}</h4>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
                <Info className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
              <p><strong>Description</strong> — the text appended to the prompt when this asset is connected to a Generate Image node.</p>
              <p className="mt-1"><strong>Generation</strong> — the prompt used when generating this asset&apos;s own image (e.g., clicking Run on a {name} node).</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {hasOverride && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#ff0073]/10 text-[#ff0073] font-medium">
            Custom
          </span>
        )}
      </div>

      {/* Tabs + Edit/Cancel */}
      <div className="flex gap-1 mb-3">
        <button
          type="button"
          onClick={() => setTab("description")}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
            tab === "description"
              ? "bg-[#ff0073]/10 text-[#ff0073] border border-[#ff0073]/30"
              : "text-muted-foreground hover:bg-muted/50 border border-transparent",
          )}
        >
          Description
        </button>
        <button
          type="button"
          onClick={() => setTab("generation")}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
            tab === "generation"
              ? "bg-[#ff0073]/10 text-[#ff0073] border border-[#ff0073]/30"
              : "text-muted-foreground hover:bg-muted/50 border border-transparent",
          )}
        >
          Generation
        </button>

        <div className="flex items-center gap-1 ml-auto">
          {isEditing && hasOverride && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => onReset(activeKey)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reset to system default</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {isEditing ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={onCancelEdit}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Cancel
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onStartEdit(activeKey)}
            >
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Edit
            </Button>
          )}
        </div>
      </div>

      {/* Content: read-only or textarea */}
      {isEditing ? (
        <>
          <textarea
            rows={3}
            value={value}
            placeholder={info.template}
            onChange={(e) => onChange(activeKey, e.target.value)}
            className={cn(
              "w-full rounded-md border px-3 py-2 text-sm font-mono resize-y",
              "bg-transparent placeholder:text-muted-foreground/50",
              "border-zinc-200 dark:border-zinc-700",
              "focus:outline-none focus:ring-2 focus:ring-[#ff0073]/30 focus:border-[#ff0073]",
            )}
            autoFocus
          />
          {info.variables.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              <span className="text-xs text-muted-foreground">Variables:</span>
              {info.variables.map((v) => (
                <span
                  key={v}
                  className="bg-zinc-100 dark:bg-zinc-800 text-xs px-1.5 py-0.5 rounded font-mono text-muted-foreground"
                >
                  {`{${v}}`}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className={cn(
          "text-xs font-mono leading-relaxed whitespace-pre-wrap",
          hasOverride ? "text-foreground" : "text-muted-foreground",
        )}>
          {displayText}
        </p>
      )}
    </div>
  )
}

function TemplateCard({
  templateKey,
  value,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onChange,
  onReset,
}: {
  readonly templateKey: string
  readonly value: string
  readonly isEditing: boolean
  readonly onStartEdit: () => void
  readonly onCancelEdit: () => void
  readonly onChange: (key: string, value: string) => void
  readonly onReset: (key: string) => void
}) {
  const info = SYSTEM_PROMPT_TEMPLATES[templateKey]
  if (!info) return null

  const hasOverride = value.trim().length > 0
  const displayText = hasOverride ? value : info.template

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold">{info.label}</h4>
            {hasOverride && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#ff0073]/10 text-[#ff0073] font-medium">
                Custom
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{info.description}</p>
        </div>

        <div className="flex items-center gap-1">
          {isEditing && hasOverride && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => onReset(templateKey)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reset to system default</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {isEditing ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={onCancelEdit}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Cancel
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={onStartEdit}
            >
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Edit
            </Button>
          )}
        </div>
      </div>

      {isEditing ? (
        <>
          <textarea
            rows={3}
            value={value}
            placeholder={info.template}
            onChange={(e) => onChange(templateKey, e.target.value)}
            className={cn(
              "w-full rounded-md border px-3 py-2 text-sm font-mono resize-y",
              "bg-transparent placeholder:text-muted-foreground/50",
              "border-zinc-200 dark:border-zinc-700",
              "focus:outline-none focus:ring-2 focus:ring-[#ff0073]/30 focus:border-[#ff0073]",
            )}
            autoFocus
          />
          {info.variables.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              <span className="text-xs text-muted-foreground">Variables:</span>
              {info.variables.map((v) => (
                <span
                  key={v}
                  className="bg-zinc-100 dark:bg-zinc-800 text-xs px-1.5 py-0.5 rounded font-mono text-muted-foreground"
                >
                  {`{${v}}`}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className={cn(
          "text-xs font-mono leading-relaxed whitespace-pre-wrap",
          hasOverride ? "text-foreground" : "text-muted-foreground",
        )}>
          {displayText}
        </p>
      )}
    </div>
  )
}
