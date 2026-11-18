"use client"

import { useEffect, useRef, type KeyboardEvent } from "react"
import { Link } from "react-router-dom"
import { X } from "lucide-react"
import { COMPETITOR_SCAN_SEARCH_LIMIT, COMPETITOR_SEARCH_TERM_MAX_LENGTH, normalizeSearchTerms } from "@nodaro/shared/social"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useT } from "@/lib/i18n"
import { interpolateNodes } from "@/lib/i18n/interpolate-nodes"
import { plansOnSale } from "@/lib/plans-on-sale"

/**
 * The terms with what was typed added: split at commas and line breaks,
 * cleaned as the server keeps them, and never past the plan's cap. Terms
 * already past the cap (kept from a higher plan) stay as they are.
 */
export function addTerms(terms: readonly string[], typed: string, cap: number): string[] {
  if (terms.length >= cap) return [...terms]
  return normalizeSearchTerms([...terms, ...typed.split(/[,\n]/)]).slice(0, cap)
}

/** Whether a key press adds the typed term: Enter or a comma, never one that confirms an IME composition (Japanese, Korean). */
export function addsTerm(e: Pick<KeyboardEvent, "key" | "keyCode"> & { readonly nativeEvent: { readonly isComposing?: boolean } }): boolean {
  if (e.nativeEvent.isComposing || e.keyCode === 229) return false
  return e.key === "Enter" || e.key === ","
}

/** The plan has no search terms: where they come from, with the plans a press away where they can be bought. */
function TermsLockedNote() {
  const t = useT()
  if (!plansOnSale()) return <p className="text-[12px] text-muted-foreground">{t("competitors.searchTermsLocked")}</p>
  const link = (
    <Link to="/pricing" className="font-semibold text-foreground underline">
      {t("credits.viewPlans")}
    </Link>
  )
  return <p className="text-[12px] text-muted-foreground">{interpolateNodes(t("competitors.searchTermsLockedPlans"), { link })}</p>
}

/** The terms as chips, each removable; a term past the plan's cap is struck through (it is kept, not searched). */
function TermChips({ terms, cap, onRemove }: { readonly terms: readonly string[]; readonly cap: number; readonly onRemove: (term: string) => void }) {
  const t = useT()
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t("competitors.searchTerms")}>
      {terms.map((term, i) => (
        <li key={term} className="flex items-center gap-1 rounded-full border border-border bg-muted/60 py-0.5 pe-1 ps-2.5 text-[12px] font-semibold">
          <span dir="auto" className={i >= cap ? "text-muted-foreground line-through" : undefined}>
            {term}
          </span>
          <button
            type="button"
            onClick={() => onRemove(term)}
            aria-label={t("competitors.removeTerm", { term })}
            className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** How many terms the plan allows, or that only the first ones are searched; with no cap, what does limit them (one scan's size). */
function TermsCapNote({ count, cap, unlimited }: { readonly count: number; readonly cap: number; readonly unlimited: boolean }) {
  const t = useT()
  if (unlimited) return <p className="text-[12px] text-muted-foreground">{t("competitors.searchTermsNoCap", { max: COMPETITOR_SCAN_SEARCH_LIMIT })}</p>
  if (cap === 0) return count > 0 ? <p className="text-[12px] text-muted-foreground">{t("competitors.searchTermsNameOnly")}</p> : null
  const text = count > cap ? t("competitors.searchTermsOverCap", { n: cap }) : t("competitors.searchTermsCap", { n: count, max: cap })
  return <p className="text-[12px] text-muted-foreground">{text}</p>
}

/**
 * Phrases or #hashtags searched instead of the brand's name, as chips. `cap`
 * is the plan's (0 below Standard: the name only, with a word on where terms
 * come from); `unlimited` when the plan has none (a platform admin: held only
 * to one scan's size). The typed text is the dialog's, so the price and Save
 * count it.
 */
export function SearchTermsField({
  terms,
  cap,
  unlimited = false,
  draft,
  onDraft,
  onChange,
}: {
  readonly terms: readonly string[]
  readonly cap: number
  readonly unlimited?: boolean
  readonly draft: string
  readonly onDraft: (draft: string) => void
  readonly onChange: (terms: readonly string[]) => void
}) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  // A chip was removed: focus goes to the add field once it is there (it may only appear now, below the cap).
  const refocus = useRef(false)
  useEffect(() => {
    if (refocus.current && input.current) {
      refocus.current = false
      input.current.focus()
    }
  })
  const add = () => {
    onChange(addTerms(terms, draft, cap))
    onDraft("")
  }
  const remove = (term: string) => {
    refocus.current = true
    onChange(terms.filter((x) => x !== term))
  }
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-sm font-medium">{t("competitors.searchTerms")}</legend>
      <p className="text-[12px] leading-normal text-muted-foreground">{t("competitors.searchTermsHint")}</p>
      {cap === 0 && <TermsLockedNote />}
      {terms.length > 0 && <TermChips terms={terms} cap={cap} onRemove={remove} />}
      {terms.length < cap && (
        <div className="flex gap-2">
          <Input
            ref={input}
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
              if (!addsTerm(e)) return
              e.preventDefault()
              add()
            }}
            placeholder={t("competitors.phSearchTerm")}
            aria-label={t("competitors.addTermLabel")}
            maxLength={COMPETITOR_SEARCH_TERM_MAX_LENGTH}
            className="h-8"
            dir="auto"
          />
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={add} disabled={!draft.trim()}>
            {t("common.add")}
          </Button>
        </div>
      )}
      <TermsCapNote count={terms.length} cap={cap} unlimited={unlimited} />
    </fieldset>
  )
}
