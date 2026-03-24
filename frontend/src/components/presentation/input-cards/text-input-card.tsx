import { GlassCard } from "../output-cards/shared"
import { ReadOnlyPromptBlock } from "../readonly-prompt-block"
import { PresentationTextInput } from "./shared"
import type { InputMode } from "@/types/nodes"
import type { PromptContext } from "@/lib/prompt-context"

interface TextInputCardProps {
  label: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
  readOnly?: boolean
  refMap?: Map<string, string>
  presentationReadOnly?: boolean
  inputMode?: InputMode
  minLines?: number
  promptHelper?: PromptContext
}

export function TextInputCard({ label, value, placeholder, onChange, readOnly, refMap, presentationReadOnly, inputMode, minLines, promptHelper }: TextInputCardProps) {
  if (presentationReadOnly && refMap) {
    return (
      <GlassCard>
        <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          {label}
        </label>
        <ReadOnlyPromptBlock text={value} refMap={refMap} />
      </GlassCard>
    )
  }

  return (
    <PresentationTextInput
      label={label}
      value={value}
      placeholder={placeholder}
      onChange={onChange}
      readOnly={readOnly}
      mode={inputMode ?? "prompt"}
      minLines={minLines}
      promptHelper={promptHelper}
    />
  )
}
