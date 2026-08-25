/**
 * The composer: text, mention chips, and one button that is Send or Stop.
 *
 * Send BECOMES Stop rather than sitting next to it — there is exactly one
 * primary action at any moment, and the user never has to look for where the
 * stop went. The hint to its left always states what will happen to their
 * credits, which is the whole contract of Ask vs Auto.
 */
import { useRef, useState } from "react"
import { ArrowUp, AtSign } from "lucide-react"
import { COPILOT_STRINGS as S } from "@/ee/lib/copilot/strings"
import { activeMentionQuery, insertMentionName, variantSuffix } from "@/ee/lib/copilot/mentions"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { copilotFeatureId } from "@/ee/lib/copilot/constants"
import { useCopilotStore } from "@/ee/lib/copilot/turn-store"
import { CopilotAttachButton } from "./copilot-attach-button"
import { CopilotMentionPicker, MENTION_LIST_ID, MentionThumb, safeThumbUrl } from "./copilot-mention-picker"
import { CopilotMentionModal } from "./copilot-mention-modal"
import { MentionPreview } from "./copilot-mention-preview"
import type { CopilotMention, CopilotMentionVariant } from "@/ee/lib/copilot/types"

interface CopilotComposerProps {
  /** The @ catalogue. Not to be confused with the chips the user has picked. */
  mentionSources: CopilotMention[]
  onSend: (text: string) => void
  onStop: () => void
  disabled?: boolean
}

export function CopilotComposer({ mentionSources, onSend, onStop, disabled }: CopilotComposerProps) {
  const draft = useCopilotStore((s) => s.draft)
  const mentions = useCopilotStore((s) => s.mentions)
  const setDraft = useCopilotStore((s) => s.setDraft)
  const addMention = useCopilotStore((s) => s.addMention)
  const removeMention = useCopilotStore((s) => s.removeMention)
  const streaming = useCopilotStore((s) => s.streaming)
  const runMode = useCopilotStore((s) => s.runMode)
  const autoRunLimit = useCopilotStore((s) => s.autoRunLimit)
  const notice = useCopilotStore((s) => s.notice)

  // The reservation ceiling for one copilot message. Cached by the hook, and
  // 0 until it resolves — in which case the badge simply stays out of the way.
  const modelTier = useCopilotStore((s) => s.modelTier)
  const turnCeiling = useModelCredits(copilotFeatureId(modelTier))

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [query, setQuery] = useState<string | null>(null)
  const [activeMentionId, setActiveMentionId] = useState<string | undefined>(undefined)
  // The full-size browser is owned HERE, not by the picker: the picker unmounts
  // on input blur (which the browser's own search autofocus causes), so a
  // browser rendered inside it died within a frame of opening.
  const [browserTab, setBrowserTab] = useState<string | null>(null)
  const [chipPreview, setChipPreview] = useState<CopilotMention | null>(null)

  const syncQuery = (value: string, caret: number) => {
    const active = activeMentionQuery(value, caret)
    setQuery(active ? active.query : null)
  }

  const pick = (mention: CopilotMention, variant?: CopilotMentionVariant) => {
    const el = inputRef.current
    const caret = el?.selectionStart ?? draft.length
    // The name stays in the sentence, at the caret — the chip alone would tell
    // the model WHO without telling it WHERE. See `insertMentionName`. A
    // variant pick appends prose the doctrine turns into a prompt token.
    const { text, caret: nextCaret } = insertMentionName(draft, caret, mention.name, variantSuffix(variant))
    addMention(mention)
    setDraft(text)
    setQuery(null)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(nextCaret, nextCaret)
    })
  }

  const openPicker = () => {
    const el = inputRef.current
    const next = draft && !/\s$/.test(draft) ? `${draft} @` : `${draft}@`
    setDraft(next)
    setQuery("")
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(next.length, next.length)
    })
  }

  const submit = () => {
    if (streaming || disabled) return
    const text = draft.trim()
    if (!text) return
    setQuery(null)
    onSend(text)
  }

  return (
    <div className="flex-none px-3.5 pt-3 pb-3.5 border-t border-border relative">
      {query !== null && (
        <CopilotMentionPicker
          query={query}
          mentions={mentionSources}
          onPick={pick}
          onActiveChange={setActiveMentionId}
          onClose={() => setQuery(null)}
          onExpand={(tab) => {
            setBrowserTab(tab)
            setQuery(null)
          }}
        />
      )}

      {browserTab !== null && (
        <CopilotMentionModal
          mentions={mentionSources}
          initialTab={browserTab}
          onPick={(mention, variant) => {
            setBrowserTab(null)
            pick(mention, variant)
          }}
          onClose={() => {
            setBrowserTab(null)
            requestAnimationFrame(() => inputRef.current?.focus())
          }}
        />
      )}

      {chipPreview && safeThumbUrl(chipPreview.imageUrl) && (
        <MentionPreview
          content={{ src: safeThumbUrl(chipPreview.imageUrl)!, label: chipPreview.name }}
          onClose={() => setChipPreview(null)}
        />
      )}

      {notice && <div className="mb-2 text-[11px] text-[var(--copilot-muted)]">{notice}</div>}

      <div className="bg-[var(--copilot-card)] border border-border rounded-xl px-2.5 pt-2.5 pb-2 focus-within:border-[var(--copilot-strong)] transition-colors">
        {mentions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {mentions.map((mention) => (
              <span
                key={`${mention.kind}:${mention.id}`}
                className="inline-flex items-center gap-1.5 pl-1 pr-1.5 py-[3px] rounded-[7px] text-[11.5px] text-foreground whitespace-nowrap bg-[var(--copilot-mention)]/10 border border-[var(--copilot-mention)]/40"
              >
                {safeThumbUrl(mention.imageUrl) ? (
                  <button
                    type="button"
                    aria-label={S.pickerPreviewOf(mention.name)}
                    title={S.pickerPreviewOf(mention.name)}
                    onClick={() => setChipPreview(mention)}
                    className="inline-flex items-center gap-1.5 cursor-zoom-in"
                  >
                    <MentionThumb mention={mention} size={16} />
                    {mention.name}
                  </button>
                ) : (
                  <>
                    <MentionThumb mention={mention} size={16} />
                    {mention.name}
                  </>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${mention.name}`}
                  onClick={() => removeMention(mention.id)}
                  className="w-3.5 h-3.5 leading-none text-[13px] text-[var(--copilot-muted)] hover:text-foreground"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <textarea
          ref={inputRef}
          rows={2}
          value={draft}
          disabled={disabled}
          placeholder={S.composerPlaceholder}
          // Focus never leaves the textarea while the picker is open, so the
          // combobox wiring is what tells a screen reader a list appeared and
          // which row the arrow keys are on.
          role="combobox"
          aria-expanded={query !== null}
          aria-controls={query !== null ? MENTION_LIST_ID : undefined}
          aria-activedescendant={query !== null ? activeMentionId : undefined}
          aria-autocomplete="list"
          onChange={(e) => {
            setDraft(e.target.value)
            syncQuery(e.target.value, e.target.selectionStart ?? e.target.value.length)
          }}
          onClick={(e) => syncQuery(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
          // The picker listens on the window in capture phase, so leaving it
          // open after the composer loses focus would swallow arrow keys and
          // Escape for the whole editor. The rows use onMouseDown-preventDefault,
          // so clicking one does not blur first.
          onBlur={() => setQuery(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          className="w-full resize-none bg-transparent border-none outline-none text-[12.5px] leading-[1.5] text-foreground placeholder:text-[var(--copilot-dim)] px-0.5 disabled:cursor-not-allowed"
        />

        <div className="flex items-center gap-2 mt-1.5">
          <button
            type="button"
            onClick={openPicker}
            disabled={disabled}
            aria-label={S.mention}
            className="w-6 h-6 rounded-md border border-border text-[var(--copilot-muted)] hover:text-[var(--copilot-mention)] hover:border-[var(--copilot-strong)] flex items-center justify-center transition-colors disabled:opacity-50"
          >
            <AtSign className="w-3 h-3" strokeWidth={2} />
          </button>
          {/* An attachment becomes a MENTION — from here on it is the same
              thing as a file picked with @, and travels the same way. */}
          <CopilotAttachButton disabled={disabled} onAttached={pick} />
          {/* The two costs a send commits to, in the order they matter: what
              this MESSAGE can cost at most, then what happens about runs. The
              upper bound is a ceiling, not a price — the turn is billed for
              actual model usage and normally lands far below it. */}
          <span
            className="text-[11px] text-[var(--copilot-dim)] truncate"
            title={turnCeiling > 0 ? S.turnCeilingFull(turnCeiling) : undefined}
          >
            {turnCeiling > 0 && <span className="tabular-nums">{S.turnCeiling(turnCeiling)} · </span>}
            {runMode === "auto" ? S.composerHintAuto(autoRunLimit) : S.composerHintAsk}
          </span>
          <button
            type="button"
            onClick={streaming ? onStop : submit}
            disabled={disabled || (!streaming && draft.trim().length === 0)}
            aria-label={streaming ? S.stop : S.send}
            className="ml-auto w-[30px] h-[30px] rounded-[9px] bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 transition-opacity"
          >
            {streaming ? (
              <span className="w-[9px] h-[9px] rounded-[2px] bg-current" aria-hidden />
            ) : (
              <ArrowUp className="w-3.5 h-3.5" strokeWidth={2.4} />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
