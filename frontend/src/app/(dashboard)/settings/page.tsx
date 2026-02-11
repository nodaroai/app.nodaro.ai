"use client"

import { useState, useEffect } from "react"
import { Loader2, Globe, Lock, RotateCcw, FileText, Save, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { toast } from "sonner"
import {
  SYSTEM_PROMPT_TEMPLATES,
  TEMPLATE_GROUPS,
  WRAPPER_TEMPLATE_KEY,
} from "@/lib/prompt-templates"

const API_BASE = ""

const PRIVATE_MODE_TIERS = new Set(["standard", "pro", "business"])

export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth()
  const [publicOutputs, setPublicOutputs] = useState(true)
  const [tier, setTier] = useState<string>("free")
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [templates, setTemplates] = useState<Record<string, string>>({})
  const [savedTemplates, setSavedTemplates] = useState<Record<string, string>>({})
  const [savingTemplates, setSavingTemplates] = useState(false)

  useEffect(() => {
    if (!user?.id) return

    async function fetchSettings() {
      setSettingsLoading(true)
      try {
        const response = await fetch(`${API_BASE}/v1/user/settings?userId=${user!.id}`)
        if (!response.ok) throw new Error("Failed to fetch settings")
        const json = await response.json()
        const data = json.data ?? json
        setPublicOutputs(data.publicOutputs ?? true)
        setTier(data.tier ?? "free")
        const pt = (data.promptTemplates ?? {}) as Record<string, string>
        setTemplates(pt)
        setSavedTemplates(pt)
      } catch (err) {
        console.error("Failed to load settings:", err)
      } finally {
        setSettingsLoading(false)
      }
    }

    fetchSettings()
  }, [user?.id])

  async function handleToggle() {
    if (!user?.id) return

    const newValue = !publicOutputs
    setSaving(true)
    try {
      const response = await fetch(`${API_BASE}/v1/user/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, publicOutputs: newValue }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Failed" }))
        throw new Error(err.error ?? "Failed to update")
      }

      setPublicOutputs(newValue)
      toast.success(newValue ? "Outputs are now public" : "Outputs are now private")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update"
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  function handleTemplateChange(key: string, value: string) {
    setTemplates((prev) => {
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
    setTemplates((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  async function handleSaveTemplates() {
    if (!user?.id) return

    setSavingTemplates(true)
    try {
      const response = await fetch(`${API_BASE}/v1/user/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, promptTemplates: templates }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Failed" }))
        throw new Error(err.error ?? "Failed to save templates")
      }

      const json = await response.json()
      const data = json.data ?? json
      const pt = (data.promptTemplates ?? {}) as Record<string, string>
      setTemplates(pt)
      setSavedTemplates(pt)
      toast.success("Prompt templates saved")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save"
      toast.error(message)
    } finally {
      setSavingTemplates(false)
    }
  }

  const hasTemplateChanges =
    JSON.stringify(templates) !== JSON.stringify(savedTemplates)

  const canToggle = PRIVATE_MODE_TIERS.has(tier)

  if (authLoading || settingsLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
                ? "Your generated images, videos, and audio appear in the public gallery."
                : "Your outputs are private and hidden from the gallery."}
            </p>
          </div>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canToggle || saving}
                    onClick={handleToggle}
                    className={cn(
                      "min-w-[100px]",
                      !publicOutputs && canToggle && "border-[#ff0073] text-[#ff0073]",
                    )}
                  >
                    {saving ? (
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

      {/* Prompt Templates */}
      <div className="mt-8">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-bold">Prompt Templates</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Customize the prompts used when generating images from asset nodes.
          Leave a field empty to use the system default (shown as placeholder).
        </p>

        {/* Asset type groups */}
        <div className="space-y-4 mb-6">
          {TEMPLATE_GROUPS.map((group) => (
            <TemplateGroupCard
              key={group.name}
              name={group.name}
              descriptionKey={group.descriptionKey}
              generationKey={group.generationKey}
              templates={templates}
              onChange={handleTemplateChange}
              onReset={handleResetTemplate}
            />
          ))}

          {/* Standalone: Generate Image Wrapper */}
          <TemplateCard
            templateKey={WRAPPER_TEMPLATE_KEY}
            value={templates[WRAPPER_TEMPLATE_KEY] ?? ""}
            onChange={handleTemplateChange}
            onReset={handleResetTemplate}
          />
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button
            onClick={handleSaveTemplates}
            disabled={savingTemplates || !hasTemplateChanges}
            className="bg-[#ff0073] hover:bg-[#e00067] text-white"
          >
            {savingTemplates ? (
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

type TemplateTab = "description" | "generation"

function TemplateGroupCard({
  name,
  descriptionKey,
  generationKey,
  templates,
  onChange,
  onReset,
}: {
  readonly name: string
  readonly descriptionKey: string
  readonly generationKey: string
  readonly templates: Record<string, string>
  readonly onChange: (key: string, value: string) => void
  readonly onReset: (key: string) => void
}) {
  const [tab, setTab] = useState<TemplateTab>("description")

  const activeKey = tab === "description" ? descriptionKey : generationKey
  const info = SYSTEM_PROMPT_TEMPLATES[activeKey]
  if (!info) return null

  const value = templates[activeKey] ?? ""
  const hasOverride = value.trim().length > 0

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
      </div>

      {/* Tabs */}
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

        {/* Reset button (right-aligned) */}
        {hasOverride && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 ml-auto text-muted-foreground hover:text-foreground"
                  onClick={() => onReset(activeKey)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reset to system default</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Textarea */}
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
      />

      {/* Variable badges */}
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
    </div>
  )
}

function TemplateCard({
  templateKey,
  value,
  onChange,
  onReset,
}: {
  readonly templateKey: string
  readonly value: string
  readonly onChange: (key: string, value: string) => void
  readonly onReset: (key: string) => void
}) {
  const info = SYSTEM_PROMPT_TEMPLATES[templateKey]
  if (!info) return null

  const hasOverride = value.trim().length > 0

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <h4 className="text-sm font-semibold">{info.label}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">{info.description}</p>
        </div>
        {hasOverride && (
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
      </div>

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
    </div>
  )
}
