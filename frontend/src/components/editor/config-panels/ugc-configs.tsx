"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { UGC_SCRIPT_DEFAULT_TARGET_SEC, UGC_SCRIPT_MAX_TARGET_SEC, UGC_SCRIPT_MIN_TARGET_SEC, ugcKeptOutputs, ugcPickPending, ugcPlanLengthSec, ugcScriptOutputs } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { CachedImage } from "@/components/ui/cached-image"
import { ClampedNumberInput } from "@/components/ui/clamped-number-input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { UgcClipsQuote } from "@/components/nodes/ugc-clips-quote"
import { UgcCreatorCandidatesPicker } from "@/components/nodes/ugc-creator-candidates"
import { useUgcCategories } from "@/hooks/use-ugc-categories"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { hasCredits } from "@/lib/edition"
import { useT } from "@/lib/i18n"
import { useLocalizeHandleLabel } from "@/lib/i18n/labels"
import { ugcCategoryLabel } from "@/lib/ugc-copy"
import { rerollUgcCreator } from "@/lib/ugc-creator-run"
import { ugcClipRuns, ugcSeconds } from "@/lib/ugc-node-cards"
import { applyScriptLineEdits, scriptLines, scriptLinesEditable, type ScriptEditWords, type ScriptLines } from "@/lib/ugc-script-edit"
import { useUgcPlanLineLimits } from "@/hooks/use-ugc-plan-line-limits"
import { VoiceBrowser } from "./voice-browser"
import type { ConfigProps } from "./types"
import type { UgcCardsData, UgcClipData, UgcClipsData, UgcCreatorData, UgcScriptData } from "@/types/nodes"

/**
 * Settings for the five UGC video nodes (Nodaro Cloud only). Each panel reads
 * and writes the node's own choices and last result, and of a script only its
 * public lines.
 */
// No dropdown here depends on a provider, so no panel needs the fail-safe effect that snaps a stale value.

const SEED_MAX = 2_147_483_647
/** The category option that leaves the override unset: UGC Script's category is used. */
const FROM_SCRIPT = "__from-script"

const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)
const filled = (x: unknown): string | undefined => (typeof x === "string" && x !== "" ? x : undefined)

type CreatorConfigProps = ConfigProps<UgcCreatorData> & { readonly nodeId?: string }

export function UgcCreatorConfig({ data, onUpdate, nodeId }: CreatorConfigProps) {
  const t = useT()
  const isReadOnly = useWorkflowStore((s) => s.isReadOnly)
  const categories = useUgcCategories()
  // The run treats every source but "photo" as an AI creator; so does the panel.
  const sampled = data.source !== "photo"
  const running = data.executionStatus === "running"
  // A run that is starting (a re-draw's save) counts as a run: the options and Show new options stay
  // in view and cannot be pressed (this panel never relies on the fieldset around it for that).
  const runStarting = (data.executionStatus as string | undefined) === "pending"
  const pickPending = !running && ugcPickPending(data)
  const canDrawAgain = sampled && !running && (ugcPickPending(data) || (data.keepResult === true && isObject(data.result)))
  const override = filled(data.categoryOverride)
  // A saved category the live list does not name (or no list where the route is not served) still shows as stored.
  const categoryOptions = override && !categories.some((c) => c.id === override) ? [...categories, { id: override, label: override }] : categories
  const gender = data.gender === "man" || data.gender === "woman" ? data.gender : ""
  // "My photo": the photo stored on the node (an import, an agent's edit) is used whenever the photo
  // input is empty, so it is shown, with the consent line, and can be removed. Publishing never ships it.
  const storedPhoto = !sampled ? filled(data.photoUrl) : undefined
  const focusAfterRemove = useRef(false)
  useEffect(() => {
    if (!focusAfterRemove.current || storedPhoto) return
    focusAfterRemove.current = false
    document.getElementById("ugc-creator-source")?.focus()
  }, [storedPhoto])
  // A pick takes the options away with the button pressed: focus moves to Show new options, which
  // takes their place for an AI creator, else to the source.
  const newOptionsRef = useRef<HTMLButtonElement>(null)
  const focusAfterPick = useRef(false)
  useEffect(() => {
    if (!focusAfterPick.current || pickPending) return
    focusAfterPick.current = false
    ;(newOptionsRef.current ?? document.getElementById("ugc-creator-source"))?.focus()
  }, [pickPending])

  return (
    <div className="flex flex-col gap-3">
      {pickPending && nodeId && (
        <UgcCreatorCandidatesPicker
          nodeId={nodeId}
          candidates={data.candidates}
          disabled={isReadOnly || runStarting}
          // The card says it already: one status region, not two.
          announce={false}
          onPicked={() => {
            focusAfterPick.current = true
          }}
        />
      )}
      {canDrawAgain && nodeId && (
        <Button ref={newOptionsRef} type="button" variant="outline" size="sm" disabled={isReadOnly || runStarting} onClick={() => rerollUgcCreator(nodeId)}>
          {t("ugc.creator.newOptions")}
        </Button>
      )}
      {data.optionFailed && <p className="text-[11px] text-muted-foreground">{t("ugc.creator.optionFailed")}</p>}

      <div>
        <Label htmlFor="ugc-creator-source">{t("creatorCard.sourceLabel")}</Label>
        <Select value={sampled ? "sampled" : "photo"} onValueChange={(v) => onUpdate({ source: v })}>
          <SelectTrigger id="ugc-creator-source" aria-label={t("creatorCard.sourceLabel")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sampled">{t("creatorCard.aiCreator")}</SelectItem>
            <SelectItem value="photo">{t("creatorCard.myPhoto")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {storedPhoto && (
        <div className="flex flex-col gap-1.5" data-testid="ugc-creator-photo">
          <div className="flex items-start gap-2">
            <CachedImage src={storedPhoto} alt={t("creatorCard.myPhoto")} className="h-20 w-20 rounded-md border object-cover" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={isReadOnly}
              onClick={() => {
                focusAfterRemove.current = true
                onUpdate({ photoUrl: undefined })
              }}
            >
              {t("present.removeImage")}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("creatorCard.photoConsent")}</p>
        </div>
      )}

      <div>
        <Label htmlFor="ugc-creator-gender">{t("creatorCard.genderLabel")}</Label>
        <Select value={gender} onValueChange={(v) => onUpdate({ gender: v })}>
          <SelectTrigger id="ugc-creator-gender" aria-label={t("creatorCard.genderLabel")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="woman">{t("creatorCard.woman")}</SelectItem>
            <SelectItem value="man">{t("creatorCard.man")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {sampled && (
        <div>
          <Label htmlFor="ugc-creator-category">{t("ugc.creator.categoryLabel")}</Label>
          <Select value={override ?? FROM_SCRIPT} onValueChange={(v) => onUpdate({ categoryOverride: v === FROM_SCRIPT ? undefined : v })}>
            <SelectTrigger id="ugc-creator-category" aria-label={t("ugc.creator.categoryLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FROM_SCRIPT}>{t("ugc.creator.categoryFromScript")}</SelectItem>
              {categoryOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {ugcCategoryLabel(c.id, c.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {sampled && (
        <div>
          <Label htmlFor="ugc-creator-seed">{t("field.seedOptional")}</Label>
          <ClampedNumberInput
            id="ugc-creator-seed"
            value={typeof data.seed === "number" ? data.seed : undefined}
            min={0}
            max={SEED_MAX}
            step={1}
            allowEmpty
            onCommit={(n) => onUpdate({ seed: n })}
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="ugc-creator-keep">{t("ugc.creator.keep")}</Label>
        <Switch id="ugc-creator-keep" checked={data.keepResult === true} onCheckedChange={(v) => onUpdate({ keepResult: v })} />
      </div>

      {hasCredits() && <p className="text-[11px] text-muted-foreground">{t("ugc.creator.priceLine")}</p>}
    </div>
  )
}

export function UgcScriptConfig({ data, onUpdate }: ConfigProps<UgcScriptData>) {
  const t = useT()
  const result = data.result
  const plan = isObject(result?.plan) ? result.plan : undefined
  const lines = useMemo(() => (plan ? scriptLines(plan) : undefined), [plan])
  // A saved plan whose lines are not where they belong is shown read only, with a note and no Edit.
  const editable = plan ? scriptLinesEditable(plan) : false
  // An edit belongs to the lines it was begun on, read by their words: the same script read again
  // (a save made elsewhere, a reload) keeps it, a script with other lines (a run finished) ends it.
  // The panel is keyed by its node (config-panel.tsx), so an edit never follows the selection.
  const linesKey = lines ? JSON.stringify(lines) : ""
  const [edit, setEdit] = useState<{ readonly of: string; readonly draft: ScriptLines; readonly error?: string } | null>(null)
  const current = edit && edit.of === linesKey ? edit : null
  const draft = current?.draft ?? null
  const error = current?.error
  // An ended edit is dropped, so lines that come back later (an Undo) never bring it back.
  useEffect(() => {
    if (edit && edit.of !== linesKey) setEdit(null)
  }, [edit, linesKey])
  const setDraft = (next: ScriptLines) => setEdit({ of: linesKey, draft: next })
  // Edit, Save and Cancel each take the button pressed away: focus goes to the first line, or back to
  // Edit. An edit a newly landed script ends moves no focus.
  const editRef = useRef<HTMLButtonElement>(null)
  const firstLineRef = useRef<HTMLTextAreaElement>(null)
  const focusNext = useRef<"first-line" | "edit" | null>(null)
  const editing = draft !== null
  useEffect(() => {
    const next = focusNext.current
    focusNext.current = null
    if (next === "first-line") firstLineRef.current?.focus()
    else if (next === "edit") editRef.current?.focus()
  }, [editing])
  const words = useMemo<ScriptEditWords>(
    () => ({
      hookEmpty: t("ugc.script.hookEmpty"),
      beatEmpty: (n) => t("ugc.script.beatEmpty", { n }),
      closerEmpty: t("ugc.script.closerEmpty"),
      linesOnly: t("ugc.script.linesOnly"),
      hookTooLong: (max) => t("ugc.script.hookTooLong", { max }),
      beatTooLong: (n, max) => t("ugc.script.beatTooLong", { n, max }),
      closerTooLong: (max) => t("ugc.script.closerTooLong", { max }),
    }),
    [t],
  )
  // The plan's line limits, as the server hands them (none from an older plugin: UGC Clips refuses then).
  const limits = useUgcPlanLineLimits()

  // Edit writes the lines into the script the node hands on (its kept result AND the output a
  // run from below reads), and keeps it, so the next run uses the edited script.
  const save = () => {
    if (!result || !plan || !draft) return
    const edited = applyScriptLineEdits(plan, draft, words, limits)
    if ("error" in edited) {
      setEdit({ of: linesKey, draft, error: edited.error })
      return
    }
    const next = { ...result, plan: edited.plan }
    onUpdate({ result: next, ugcOutputs: ugcScriptOutputs(next), keepResult: true })
    focusNext.current = "edit"
    setEdit(null)
  }
  const cancel = () => {
    focusNext.current = "edit"
    setEdit(null)
  }

  const source = draft ?? lines
  const rows = source
    ? [
        { key: "hook", label: t("ugc.script.hookLabel"), text: source.hook, set: (v: string) => draft && setDraft({ ...draft, hook: v }) },
        ...source.beats.map((text, i) => ({
          key: `beat-${i}`,
          label: t("ugc.script.beatLabel", { n: i + 1 }),
          text,
          set: (v: string) => draft && setDraft({ ...draft, beats: draft.beats.map((b, j) => (j === i ? v : b)) }),
        })),
        { key: "closer", label: t("ugc.script.closerLabel"), text: source.closer, set: (v: string) => draft && setDraft({ ...draft, closer: v }) },
      ]
    : []
  const rounds = typeof result?.rounds === "number" && Number.isInteger(result.rounds) && result.rounds >= 1 ? result.rounds : undefined
  // A kept script is handed on as written: its length is the one it was written to, and the setting
  // cannot change it (nor the price, which reads the same length) until Keep is turned off.
  const keptLength = ugcKeptOutputs("ugc-script", data) !== null
  const setLength = typeof data.targetDurationSec === "number" ? data.targetDurationSec : UGC_SCRIPT_DEFAULT_TARGET_SEC

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="ugc-script-length">{t("ugc.script.length")}</Label>
        <ClampedNumberInput
          id="ugc-script-length"
          value={keptLength ? (ugcPlanLengthSec(plan) ?? setLength) : setLength}
          min={UGC_SCRIPT_MIN_TARGET_SEC}
          max={UGC_SCRIPT_MAX_TARGET_SEC}
          step={1}
          disabled={keptLength}
          aria-describedby={keptLength ? "ugc-script-length-kept" : undefined}
          onCommit={(n) => {
            if (n !== undefined && !keptLength) onUpdate({ targetDurationSec: n })
          }}
        />
        {keptLength && (
          <p id="ugc-script-length-kept" className="mt-1 text-[11px] text-muted-foreground">{t("ugc.script.lengthKept")}</p>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="ugc-script-keep">{t("ugc.script.keep")}</Label>
        <Switch id="ugc-script-keep" checked={data.keepResult === true} onCheckedChange={(v) => onUpdate({ keepResult: v })} />
      </div>

      {rows.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2" data-testid="ugc-script-lines">
          {rows.map((row) =>
            draft ? (
              <div key={row.key} className="flex flex-col gap-1">
                <Label htmlFor={`ugc-script-line-${row.key}`} className="text-[11px] text-muted-foreground">
                  {row.label}
                </Label>
                <Textarea
                  ref={row.key === "hook" ? firstLineRef : undefined}
                  id={`ugc-script-line-${row.key}`}
                  dir="auto"
                  rows={2}
                  value={row.text}
                  onChange={(e) => row.set(e.target.value)}
                />
              </div>
            ) : (
              <div key={row.key} className="flex flex-col gap-0.5">
                <span className="text-[11px] font-medium text-muted-foreground">{row.label}</span>
                <p dir="auto" className="text-xs leading-snug whitespace-pre-wrap">
                  {row.text}
                </p>
              </div>
            ),
          )}
          {error && (
            <p role="alert" className="text-[11px] text-red-500">
              {error}
            </p>
          )}
          {!editable ? (
            <p className="text-[11px] text-muted-foreground">{t("ugc.script.linesOnly")}</p>
          ) : draft ? (
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={save}>
                {t("common.save")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={cancel}>
                {t("common.cancel")}
              </Button>
            </div>
          ) : (
            <Button
              ref={editRef}
              type="button"
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => {
                if (!lines) return
                focusNext.current = "first-line"
                setDraft(lines)
              }}
            >
              {t("common.edit")}
            </Button>
          )}
        </div>
      )}

      {rounds !== undefined && (
        <p className="text-[11px] text-muted-foreground">
          {rounds === 1 ? t("ugc.script.roundsOne", { n: rounds }) : t("ugc.script.roundsMany", { n: rounds })}
        </p>
      )}
    </div>
  )
}

export function UgcClipsConfig({ data, onUpdate }: ConfigProps<UgcClipsData>) {
  const t = useT()
  const voiceId = filled(data.voiceId)
  // Use the default voice takes itself away when pressed: focus goes back to the voice picker.
  const voiceTriggerId = useId()
  const voiceLabelId = useId()
  const focusVoiceAfterClear = useRef(false)
  useEffect(() => {
    if (!focusVoiceAfterClear.current || voiceId) return
    focusVoiceAfterClear.current = false
    document.getElementById(voiceTriggerId)?.focus()
  }, [voiceId, voiceTriggerId])
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label id={voiceLabelId}>{t("field.voice")}</Label>
        {/* Unset is the default voice; the run sends the chosen voice's id only. */}
        <VoiceBrowser
          triggerId={voiceTriggerId}
          triggerLabelledBy={voiceLabelId}
          value={voiceId ?? ""}
          valueLabel={voiceId ? filled(data.voiceDisplayName) : t("ugc.clips.defaultVoice")}
          onSelect={(id, name) => onUpdate({ voiceId: id, voiceDisplayName: name })}
        />
        {voiceId && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1 h-7 px-2 text-xs"
            onClick={() => {
              focusVoiceAfterClear.current = true
              onUpdate({ voiceId: undefined, voiceDisplayName: undefined })
            }}
          >
            {t("ugc.clips.useDefaultVoice")}
          </Button>
        )}
      </div>
      {hasCredits() && <UgcClipsQuote quote={data.quote} status={data.executionStatus} />}
    </div>
  )
}

export function UgcClipConfig({ data, onUpdate }: ConfigProps<UgcClipData>) {
  const t = useT()
  const idPrefix = useId()
  const runs = ugcClipRuns(data)
  const counts: Record<string, unknown> = isObject(data.rerender) ? data.rerender : {}
  // Pressed for Re-render and not rendered since: a mark goes when a run lands that clip's take, never when a run starts.
  const pending: Record<string, unknown> = isObject(data.rerenderPending) ? data.rerenderPending : {}
  // A press changes that clip's content key only: the next run renders it again and reuses the others.
  const rerender = (clip: number) => {
    const key = String(clip)
    const prev = counts[key]
    const n = typeof prev === "number" && Number.isInteger(prev) && prev >= 0 ? prev : 0
    onUpdate({ rerender: { ...counts, [key]: n + 1 }, rerenderPending: { ...pending, [key]: true } })
  }
  return (
    <div className="flex flex-col gap-3">
      {runs.length > 0 && (
        <ul className="flex flex-col gap-1.5" data-testid="ugc-clip-runs">
          {runs.map((r) => {
            const nameId = `${idPrefix}-clip-${r.clip}-name`
            const buttonId = `${idPrefix}-clip-${r.clip}-rerender`
            const warningsId = `${idPrefix}-clip-${r.clip}-warnings`
            const markId = `${idPrefix}-clip-${r.clip}-mark`
            const marked = pending[String(r.clip)] === true
            const described = [r.warnings > 0 ? warningsId : "", marked ? markId : ""].filter(Boolean).join(" ")
            return (
              <li key={r.clip} className="flex items-center justify-between gap-2 text-xs">
                <div className="flex flex-col">
                  <span id={nameId} className="tabular-nums">
                    {r.durationSec !== undefined ? t("ugc.clips.clipLength", { n: r.clip, seconds: ugcSeconds(r.durationSec) }) : t("ugc.clip.clipN", { n: r.clip })}
                  </span>
                  {r.warnings > 0 && (
                    <span id={warningsId} className="text-[11px] text-amber-600 dark:text-amber-400">
                      {r.warnings === 1 ? t("ugc.clip.warningsOne", { n: 1 }) : t("ugc.clip.warningsMany", { n: r.warnings })}
                    </span>
                  )}
                  {marked && (
                    <span id={markId} className="text-[11px] text-muted-foreground">
                      {t("ugc.clip.rerenderNext")}
                    </span>
                  )}
                </div>
                {/* A name of its own: the action, then the clip ("Re-render Clip 2 · 7s"). */}
                <Button
                  id={buttonId}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  aria-labelledby={`${buttonId} ${nameId}`}
                  aria-describedby={described || undefined}
                  onClick={() => rerender(r.clip)}
                >
                  {t("ugc.clip.rerender")}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">{t("ugc.clip.reuseNote")}</p>
    </div>
  )
}

export function UgcCardsConfig({ data }: ConfigProps<UgcCardsData>) {
  const t = useT()
  const localizeHandle = useLocalizeHandleLabel()
  const report = filled(data.result?.report)
  // The node has no settings: one line says what it does, and the last run's Notes follow it.
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-muted-foreground">{t("ugc.cards.panelNote")}</p>
      {report && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">{localizeHandle("Notes")}</span>
          <p dir="auto" className="whitespace-pre-wrap rounded-md border bg-muted/30 p-2 text-xs leading-snug">
            {report}
          </p>
        </div>
      )}
    </div>
  )
}
