// "Style the role pictures" (`steps.styleRefs`): for a run that chose an art
// style (Flex only), each role's reference picture is first redrawn in that
// style by an image model, so the video model sees every person already drawn
// in it. Priced in the run's quote by the engine.
//
// - Off until the admin turns it On: the key left out is Off on every engine.
//   What the admin picks is always saved as it is (`{ mode, send }`, Off
//   included), never dropped because it matches this environment's default:
//   the setting is shared by environments.
// - "Send": the styled picture as the role's main reference AND the original
//   photo beside it (within the engine's picture limit), or the styled picture
//   only.
// - The image instruction of its own replaces the engine's (shown as the
//   placeholder, read from the engine's defaults at run time, never written
//   here); "Use the default" removes it.
// - On is offered only once every environment's engine declares
//   `castSwap.styleRefs` (`offered`): the server refuses the shared setting
//   otherwise, and a trend that turns it on can't be published there. Off is
//   always choosable, so a setting turned on before can be turned off.

import { useId } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  STYLE_REFS_DEFAULT_SEND,
  STYLE_REFS_PROMPT_MAX,
  type CastSwapStepDefaults,
  type CastSwapStepsProblem,
  type StyleRefsSend,
  type StyleRefsSetting,
} from "@/lib/api"
import { Problems } from "./LlmStepEditor"

export const STYLE_REFS_HINT =
  "Only for runs with an art style: each role's picture is redrawn in that style first, so the video model sees the person already in the style. Priced in the run's quote."

export const STYLE_REFS_SEND_OPTIONS: ReadonlyArray<{ value: StyleRefsSend; label: string }> = [
  { value: "styled-and-original", label: "Styled picture + original" },
  { value: "styled", label: "Styled picture only" },
]

/** Whether the setting needs every environment's engine to run the step: only On (the server's `styleRefsNeedsEngine`). */
export function styleRefsNeedsEngine(s: StyleRefsSetting | undefined): boolean {
  return s?.mode === "on"
}

/** The setting as picked: always its explicit mode and send (the row is shared), the instruction when it has one. */
function picked(mode: StyleRefsSetting["mode"], send: StyleRefsSend, prompt: string | undefined): StyleRefsSetting {
  const kept = prompt !== undefined && prompt.trim() !== "" ? prompt : undefined
  return kept !== undefined ? { mode, send, prompt: kept } : { mode, send }
}

interface Props {
  /** The setting; undefined = Off (the engine's default). */
  readonly value: StyleRefsSetting | undefined
  readonly onChange: (next: StyleRefsSetting) => void
  /** This environment's engine's defaults for the step (undefined while loading, or from an engine without it). */
  readonly defaults: CastSwapStepDefaults["defaults"]["styleRefs"] | undefined
  /** Every environment's engine runs the step (it may be turned on and edited). */
  readonly offered: boolean
  /** The environments whose engine cannot run it (named while greyed out; unknown while loading). */
  readonly notYetIn: readonly string[] | undefined
  /** The check's problems under `styleRefs`, their paths relative to it. */
  readonly problems: readonly CastSwapStepsProblem[]
}

export function StyleRefsStep({ value, onChange, defaults, offered, notYetIn, problems }: Props) {
  const id = useId()
  const on = value?.mode === "on"
  const send = value?.send ?? defaults?.send ?? STYLE_REFS_DEFAULT_SEND
  const editable = offered && on
  const sendId = `${id}-send`
  const promptId = `${id}-prompt`
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-xs text-muted-foreground">{STYLE_REFS_HINT}</p>
      {notYetIn && notYetIn.length > 0 && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          The Cast Swap engine of {notYetIn.join(", ")} cannot style the role pictures yet: the step stays off there
          {on ? ". Turn it off to publish or save." : "."}
        </p>
      )}
      <label className="flex min-h-9 items-center gap-2 text-sm">
        <Switch
          aria-label="Style the role pictures"
          checked={on}
          // Off is always choosable; On only once every environment's engine runs the step.
          disabled={!on && !offered}
          onCheckedChange={(checked) => onChange(picked(checked ? "on" : "off", send, value?.prompt))}
        />
        <span className="font-medium">{on ? "On" : "Off"}</span>
      </label>

      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <label htmlFor={sendId} className="font-medium">
          Send
        </label>
        <Select value={send} disabled={!editable} onValueChange={(v) => onChange(picked("on", v as StyleRefsSend, value?.prompt))}>
          <SelectTrigger id={sendId} className="h-9 w-full sm:w-72" aria-describedby={`${sendId}-hint`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STYLE_REFS_SEND_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span id={`${sendId}-hint`} className="text-xs text-muted-foreground">
          {send === "styled"
            ? "Each role sends its styled picture alone."
            : "Each role sends its styled picture as its main reference, with the original photo beside it (within the engine's picture limit)."}
        </span>
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={promptId} className="text-sm font-medium">
            Image instruction
          </label>
          {value?.prompt !== undefined && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="min-h-9"
              aria-label="Style the role pictures: use the default image instruction"
              onClick={() => onChange(picked(value.mode, send, undefined))}
            >
              Use the default
            </Button>
          )}
        </div>
        <Textarea
          id={promptId}
          rows={4}
          maxLength={STYLE_REFS_PROMPT_MAX}
          value={value?.prompt ?? ""}
          placeholder={defaults?.prompt}
          disabled={!editable}
          aria-describedby={`${promptId}-hint`}
          onChange={(e) => onChange(picked("on", send, e.target.value))}
        />
        <span id={`${promptId}-hint`} className="text-xs text-muted-foreground">
          Empty: the engine's default (shown greyed out above). At most {STYLE_REFS_PROMPT_MAX.toLocaleString("en-US")} characters.
        </span>
      </div>
      <Problems list={problems} />
    </div>
  )
}
