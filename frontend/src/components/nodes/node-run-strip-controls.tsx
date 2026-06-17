import type { ReactNode } from "react"
import { Sparkles, Ratio, Maximize2, Copy } from "lucide-react"
import { PromptEditButton } from "./prompt-edit-button"
import { RunNodeButton } from "./run-node-button"
import { ModelSearchSelect } from "@/components/editor/config-panels/model-search-select"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
// AspectRatioItem is exported from aspect-ratio-selector.tsx (moved there from
// generate-image-quick-toolbar.tsx so the toolbar and this shared row render
// identical option rows). It needs only SelectItem + the local RatioIcon.
import { AspectRatioItem } from "@/components/editor/config-panels/aspect-ratio-selector"

export interface RunStripSelectOption { readonly value: string; readonly label: string }

export interface NodeRunStripControlsProps {
  readonly nodeId: string
  readonly isRunning: boolean
  readonly credits?: number
  readonly onRun: (nodeId: string) => void
  /** Optional dropdown open/close notifier — PILL presentation only (keeps the
   *  hover toolbar visible while a portaled menu is open). In-body omits it. */
  readonly onOpenChange?: (open: boolean) => void

  // Model
  readonly isMulti: boolean
  readonly modelLabel: string
  readonly currentProvider: string
  readonly modelOptions: readonly RunStripSelectOption[]
  readonly onModelChange: (v: string) => void
  /** Per-row capability tooltip for the model select (video threads
   *  `getVideoModelCapabilitiesTooltip`; image omits it). Preserves the
   *  existing per-toolbar model-row tooltip behavior byte-for-byte. */
  readonly modelGetTooltip?: (value: string) => string | undefined

  // Aspect / resolution / versions
  readonly aspectOptions: readonly RunStripSelectOption[]
  readonly currentAspect: string
  readonly aspectShort: string
  readonly onAspectChange: (v: string) => void
  readonly resolutionOptions?: readonly RunStripSelectOption[]
  readonly currentResolution: string
  readonly resolutionShort: string
  readonly onResolutionChange: (v: string) => void
  readonly repeatCount: number
  readonly onRepeatChange: (v: string) => void

  /** Provider-specific control rendered immediately AFTER the model select
   *  (e.g. video's Seedance-2 input-mode lever). Image omits it. Placed here so
   *  the in-strip order matches the original per-node toolbar exactly. */
  readonly afterModel?: ReactNode
  /** Provider-specific control rendered immediately AFTER the aspect select
   *  (e.g. video's Duration lever). Image omits it. */
  readonly afterAspect?: ReactNode

  /** Tailwind classes for the ghost select triggers (passed by the caller so
   *  pill and in-body can tune sizing). */
  readonly ghostTriggerClass: string
}

export function NodeRunStripControls(props: NodeRunStripControlsProps) {
  const onOpen = props.onOpenChange
  return (
    <>
      <PromptEditButton nodeId={props.nodeId} />

      {props.isMulti ? (
        <span
          className="flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] cursor-default whitespace-nowrap text-neutral-900/70 dark:text-white/70"
          title="Multi-provider — open settings to edit cohort"
        >
          <Sparkles className="w-3 h-3 opacity-70" />
          {props.modelLabel}
        </span>
      ) : (
        <ModelSearchSelect
          disabled={props.isRunning}
          value={props.currentProvider}
          onChange={props.onModelChange}
          onOpenChange={onOpen}
          options={props.modelOptions as never}
          getTooltip={props.modelGetTooltip}
          triggerLabel={props.modelLabel}
          triggerIcon={<Sparkles className="opacity-70" />}
          triggerClassName={`${props.ghostTriggerClass} max-w-[180px]`}
          contentClassName="node-menu-surface"
          ariaLabel="Model"
        />
      )}

      {props.afterModel}

      {props.aspectOptions.length > 0 && (
        <Select disabled={props.isRunning} value={props.currentAspect} onValueChange={props.onAspectChange} onOpenChange={onOpen}>
          <SelectTrigger className={props.ghostTriggerClass}>
            <Ratio className="opacity-70" />
            <SelectValue>{props.aspectShort}</SelectValue>
          </SelectTrigger>
          <SelectContent className="node-menu-surface">
            {props.aspectOptions.map((opt) => (
              <AspectRatioItem key={opt.value} value={opt.value} label={opt.label} />
            ))}
          </SelectContent>
        </Select>
      )}

      {props.afterAspect}

      {props.resolutionOptions && props.resolutionOptions.length > 0 && (
        <Select disabled={props.isRunning} value={props.currentResolution} onValueChange={props.onResolutionChange} onOpenChange={onOpen}>
          <SelectTrigger className={props.ghostTriggerClass}>
            <Maximize2 className="opacity-70" />
            <SelectValue>{props.resolutionShort}</SelectValue>
          </SelectTrigger>
          <SelectContent className="node-menu-surface">
            {props.resolutionOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select disabled={props.isRunning} value={String(props.repeatCount)} onValueChange={props.onRepeatChange} onOpenChange={onOpen}>
        <SelectTrigger className={props.ghostTriggerClass} title="Versions per run">
          <Copy className="opacity-70" />
          <SelectValue>× {props.repeatCount}</SelectValue>
        </SelectTrigger>
        <SelectContent className="node-menu-surface">
          {[1, 2, 3, 4].map((n) => (
            <SelectItem key={n} value={String(n)} className="text-xs">× {n}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <RunNodeButton nodeId={props.nodeId} credits={props.credits} isRunning={props.isRunning} onRun={props.onRun} />
    </>
  )
}
