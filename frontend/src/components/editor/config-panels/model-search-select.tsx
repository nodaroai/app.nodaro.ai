"use client"

import { useMemo, useState, type ReactNode } from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { formatCreditBadge } from "@/components/editor/config-panels/model-options"
import { modelSearchHaystack, modelMatchesQuery } from "@/lib/model-search"

export type ModelOption = {
  value: string
  label: string
  desc?: string
  tooltip?: string
}

interface ModelSearchSelectProps {
  value: string
  onChange: (value: string) => void
  options: readonly ModelOption[]
  /** Computes a hover tooltip for a row when the option itself carries none. */
  getTooltip?: (value: string) => string | undefined
  /** Controlled-open plumbing (the canvas quick toolbars use this). Falls back
   *  to internal state when omitted. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  triggerClassName?: string
  /** Merged into PopoverContent — e.g. "z-[9999]" for pickers inside a modal. */
  contentClassName?: string
  /** Overrides the trigger's displayed label (e.g. "3 models"). */
  triggerLabel?: ReactNode
  triggerIcon?: ReactNode
  align?: "start" | "center" | "end"
  ariaLabel?: string
  placeholder?: string
  disabled?: boolean
}

const DEFAULT_PLACEHOLDER = "Search — name, company, 16:9, 2K, 720, 8s…"

export function ModelSearchSelect({
  value,
  onChange,
  options,
  getTooltip,
  open,
  onOpenChange,
  triggerClassName,
  contentClassName,
  triggerLabel,
  triggerIcon,
  align = "start",
  ariaLabel,
  placeholder = DEFAULT_PLACEHOLDER,
  disabled,
}: ModelSearchSelectProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = open ?? internalOpen
  const [query, setQuery] = useState("")

  const setOpen = (next: boolean) => {
    if (open === undefined) setInternalOpen(next)
    onOpenChange?.(next)
    if (!next) setQuery("")
  }

  const selected = options.find((o) => o.value === value)
  const display = triggerLabel ?? selected?.label ?? value

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return options
    return options.filter((o) =>
      modelMatchesQuery(modelSearchHaystack(o.value, o.label, o.desc), q),
    )
  }, [options, query])

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={isOpen}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", triggerClassName)}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {triggerIcon}
            <span className="truncate">{display}</span>
          </span>
          <ChevronsUpDown className="ml-1 size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className={cn("w-[300px] p-0", contentClassName)}>
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={placeholder} />
          <CommandList>
            {filtered.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">No models match.</div>
            ) : (
              filtered.map((o) => (
                <ModelCommandItem
                  key={o.value}
                  option={o}
                  selected={o.value === value}
                  tooltip={o.tooltip ?? getTooltip?.(o.value)}
                  onSelect={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                />
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Fresh reimplementation of ModelSelectOption's look as a cmdk row.
 * NOT a reuse of SelectItemWithMeta — that is a Radix Select.Item and throws
 * outside a <Select> context.
 */
function ModelCommandItem({
  option,
  selected,
  tooltip,
  onSelect,
}: {
  option: ModelOption
  selected: boolean
  tooltip?: string
  onSelect: () => void
}) {
  const badge = formatCreditBadge(option.value, useModelCredits(option.value))

  const item = (
    <CommandItem
      value={option.value}
      onSelect={onSelect}
      className="flex-col items-start gap-0.5 py-2"
    >
      <span className="flex w-full items-center gap-2">
        <Check className={cn("size-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")} />
        <span className="truncate">{option.label}</span>
        {badge && (
          <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{badge}</span>
        )}
      </span>
      {option.desc && (
        <span className="pl-[1.375rem] text-[11px] leading-tight text-muted-foreground/70">
          {option.desc}
        </span>
      )}
    </CommandItem>
  )

  const tip = tooltip ?? option.desc
  if (!tip) return item

  return (
    <TooltipProvider delayDuration={2000}>
      <Tooltip>
        <TooltipTrigger asChild>{item}</TooltipTrigger>
        <TooltipContent side="right" className="max-w-[260px] whitespace-pre-line">
          {tip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
