"use client"

import { useState, useEffect } from "react"
import { RotateCcw, Save, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  SYSTEM_PROMPT_TEMPLATES,
  TEMPLATE_GROUPS,
  WRAPPER_TEMPLATE_KEY,
} from "@/lib/prompt-templates"

type TemplateTab = "description" | "generation"

interface FlowTemplatesDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly flowTemplates: Record<string, string>
  readonly userTemplates: Record<string, string>
  readonly onSave: (templates: Record<string, string>) => void
}

export function FlowTemplatesDialog({
  open,
  onOpenChange,
  flowTemplates,
  userTemplates,
  onSave,
}: FlowTemplatesDialogProps) {
  const [draft, setDraft] = useState<Record<string, string>>({})

  // Reset draft when dialog opens
  useEffect(() => {
    if (open) {
      setDraft({ ...flowTemplates })
    }
  }, [open, flowTemplates])

  function handleChange(key: string, value: string) {
    setDraft((prev) => {
      const next = { ...prev }
      if (value.trim() === "") {
        delete next[key]
      } else {
        next[key] = value
      }
      return next
    })
  }

  function handleReset(key: string) {
    setDraft((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function handleSave() {
    onSave(draft)
    onOpenChange(false)
  }

  function handleCancel() {
    onOpenChange(false)
  }

  function getPlaceholder(key: string): string {
    return userTemplates[key] || SYSTEM_PROMPT_TEMPLATES[key]?.template || ""
  }

  const hasChanges = JSON.stringify(draft) !== JSON.stringify(flowTemplates)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Workflow Prompt Templates</DialogTitle>
          <DialogDescription>
            Override prompt templates for this workflow only. Leave empty to use your default settings.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 space-y-4 pr-1">
          {TEMPLATE_GROUPS.map((group) => (
            <FlowTemplateGroupCard
              key={group.name}
              name={group.name}
              descriptionKey={group.descriptionKey}
              generationKey={group.generationKey}
              draft={draft}
              getPlaceholder={getPlaceholder}
              onChange={handleChange}
              onReset={handleReset}
            />
          ))}

          {/* Standalone: Generate Image Wrapper */}
          <FlowTemplateCard
            templateKey={WRAPPER_TEMPLATE_KEY}
            value={draft[WRAPPER_TEMPLATE_KEY] ?? ""}
            placeholder={getPlaceholder(WRAPPER_TEMPLATE_KEY)}
            onChange={handleChange}
            onReset={handleReset}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!hasChanges}
            className="bg-[#ff0073] hover:bg-[#e00067] text-white"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FlowTemplateGroupCard({
  name,
  descriptionKey,
  generationKey,
  draft,
  getPlaceholder,
  onChange,
  onReset,
}: {
  readonly name: string
  readonly descriptionKey: string
  readonly generationKey: string
  readonly draft: Record<string, string>
  readonly getPlaceholder: (key: string) => string
  readonly onChange: (key: string, value: string) => void
  readonly onReset: (key: string) => void
}) {
  const [tab, setTab] = useState<TemplateTab>("description")

  const activeKey = tab === "description" ? descriptionKey : generationKey
  const info = SYSTEM_PROMPT_TEMPLATES[activeKey]
  if (!info) return null

  const value = draft[activeKey] ?? ""
  const hasOverride = value.trim().length > 0
  const placeholder = getPlaceholder(activeKey)

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-4">
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
              <p><strong>Description</strong> -- text appended when this asset is connected to Generate Image.</p>
              <p className="mt-1"><strong>Generation</strong> -- prompt used when generating this asset&apos;s own image.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {hasOverride && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#ff0073]/10 text-[#ff0073] font-medium">
            Override
          </span>
        )}
      </div>

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

        {hasOverride && (
          <div className="ml-auto">
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
                <TooltipContent>Clear flow override</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </div>

      <textarea
        rows={3}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(activeKey, e.target.value)}
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

function FlowTemplateCard({
  templateKey,
  value,
  placeholder,
  onChange,
  onReset,
}: {
  readonly templateKey: string
  readonly value: string
  readonly placeholder: string
  readonly onChange: (key: string, value: string) => void
  readonly onReset: (key: string) => void
}) {
  const info = SYSTEM_PROMPT_TEMPLATES[templateKey]
  if (!info) return null

  const hasOverride = value.trim().length > 0

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold">{info.label}</h4>
            {hasOverride && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#ff0073]/10 text-[#ff0073] font-medium">
                Override
              </span>
            )}
          </div>
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
              <TooltipContent>Clear flow override</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      <textarea
        rows={3}
        value={value}
        placeholder={placeholder}
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
