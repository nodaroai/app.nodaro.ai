"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Optional context for auto-associating SelectTrigger with an enclosing label.
 * Used by MappableField to provide accessible names via htmlFor/aria-labelledby.
 */
export const MappableFieldCtx = React.createContext<{ labelId: string; triggerId: string; title: string } | null>(null)

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  id: explicitId,
  "aria-labelledby": explicitLabelledBy,
  "aria-label": explicitAriaLabel,
  title: explicitTitle,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  // Auto-associate with enclosing MappableField label when available
  const mfCtx = React.useContext(MappableFieldCtx)
  const resolvedId = explicitId ?? mfCtx?.triggerId
  const labelledBy = explicitLabelledBy ?? mfCtx?.labelId
  const title = explicitTitle ?? mfCtx?.title
  const ariaLabel = explicitAriaLabel ?? mfCtx?.title

  // Imperatively set accessible attributes on the DOM node because Radix
  // Select's internal Slot/Popper composition strips React-level aria props.
  const setA11y = React.useCallback(
    (node: HTMLButtonElement | null) => {
      if (!node) return
      if (ariaLabel) node.setAttribute("aria-label", ariaLabel)
      if (title) node.setAttribute("title", title)
      if (resolvedId) node.setAttribute("id", resolvedId)
      if (labelledBy) node.setAttribute("aria-labelledby", labelledBy)
    },
    [ariaLabel, title, resolvedId, labelledBy],
  )

  return (
    <SelectPrimitive.Trigger
      ref={setA11y}
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "cursor-pointer border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  // `popper` flips above the trigger when there isn't room below and respects
  // viewport edges via Radix's built-in collision detection. `item-aligned`
  // (Radix's default) tries to anchor the selected item under the trigger and
  // gets clipped near the viewport bottom — that's the cut-off dropdowns the
  // user reported. Defaulting to popper fixes it globally for every Select.
  position = "popper",
  align = "center",
  sideOffset = 4,
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border shadow-md",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("text-muted-foreground px-2 py-1.5 text-xs", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-pointer items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-2 flex size-3.5 items-center justify-center"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectItemWithMeta({
  className,
  children,
  badge,
  description,
  tooltip,
  descriptionClassName,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & {
  badge?: string
  description?: string
  /** Overrides what appears in the right-side hover tooltip. The inline
   *  description below the label still renders unchanged. Use when the
   *  inline text and the hover surface should differ — e.g., a model row
   *  shows the marketing description inline but the tooltip surfaces
   *  capability detail (durations / resolutions / ratios). */
  tooltip?: string
  descriptionClassName?: string
}) {
  const item = (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-pointer flex-col gap-0.5 rounded-sm py-2 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-2 top-2.5 flex size-3.5 items-center justify-center"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <span className="flex w-full items-center gap-2">
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        {badge && (
          <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
            {badge}
          </span>
        )}
      </span>
      {description && (
        <span className={cn("text-[11px] leading-tight text-muted-foreground/70", descriptionClassName)}>
          {description}
        </span>
      )}
    </SelectPrimitive.Item>
  )

  const tooltipContent = tooltip ?? description
  if (!tooltipContent) return item

  return (
    <TooltipPrimitive.Provider delayDuration={2000}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          {item}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="right"
            sideOffset={8}
            className="bg-foreground text-background z-50 rounded-md px-3 py-1.5 text-xs max-w-[260px] whitespace-pre-line"
          >
            {tooltipContent}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("bg-border pointer-events-none -mx-1 my-1 h-px", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectItemWithMeta,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
