"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Search } from "lucide-react"
import { toast } from "sonner"
import {
  COMPETITOR_ABOUT_PLATFORMS,
  COMPETITOR_ACCOUNT_KEYS,
  COMPETITOR_DEFAULT_ABOUT_PLATFORMS,
  COMPETITOR_SCHEDULES,
  competitorScanCreditId,
  competitorScanCredits,
  competitorScanSearches,
  type CompetitorAboutPlatform,
  type CompetitorAccountKey,
  type CompetitorDiscovery,
  type CompetitorSchedule,
  type CreateCompetitorInput,
  type TrackedCompetitor,
  type UpdateCompetitorInput,
} from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { CreditCost } from "@/components/ui/credit-cost"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { SOCIAL_PLATFORM_META } from "@/components/research/social-platforms"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { discoverCompetitor } from "@/lib/api"
import { useT, type MessageKey } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { SCHEDULE_LABEL } from "./schedule-label"

const ACCOUNT_PLACEHOLDER: Readonly<Record<CompetitorAccountKey, MessageKey>> = {
  tiktok: "competitors.phHandle",
  instagram: "competitors.phHandle",
  youtube: "competitors.phChannel",
  x: "competitors.phHandle",
  linkedin: "competitors.phCompany",
  meta_ads: "competitors.phAdvertiser",
}

export interface CompetitorFormState {
  readonly brand: string
  readonly website: string
  readonly accounts: Readonly<Record<CompetitorAccountKey, string>>
  readonly guessed: ReadonlySet<CompetitorAccountKey>
  readonly aboutPlatforms: readonly CompetitorAboutPlatform[]
  readonly schedule: CompetitorSchedule
  readonly isOwn: boolean
}

const EMPTY_ACCOUNTS = Object.fromEntries(COMPETITOR_ACCOUNT_KEYS.map((k) => [k, ""])) as Record<CompetitorAccountKey, string>

export function emptyForm(): CompetitorFormState {
  return { brand: "", website: "", accounts: EMPTY_ACCOUNTS, guessed: new Set(), aboutPlatforms: COMPETITOR_DEFAULT_ABOUT_PLATFORMS, schedule: "weekly", isOwn: false }
}

export function formFrom(c: TrackedCompetitor): CompetitorFormState {
  return {
    brand: c.brand,
    website: c.website,
    accounts: { ...EMPTY_ACCOUNTS, ...c.accounts },
    guessed: new Set(),
    aboutPlatforms: c.aboutPlatforms,
    schedule: c.schedule,
    isOwn: c.isOwn,
  }
}

/** The form as the API's input: accounts trimmed, empty ones left out. */
export function inputFrom(form: CompetitorFormState): CreateCompetitorInput {
  const accounts = Object.fromEntries(COMPETITOR_ACCOUNT_KEYS.flatMap((k) => (form.accounts[k].trim() ? [[k, form.accounts[k].trim()]] : [])))
  return {
    brand: form.brand.trim(),
    website: form.website.trim(),
    accounts,
    aboutPlatforms: [...form.aboutPlatforms],
    schedule: form.schedule,
    isOwn: form.isOwn,
  }
}

/**
 * A website lookup folded into the form as it is NOW: only empty account
 * fields are filled, so anything typed meanwhile stays, and earlier guesses
 * keep their badge.
 */
export function mergeDiscovery(cur: CompetitorFormState, found: CompetitorDiscovery): CompetitorFormState {
  const fills = COMPETITOR_ACCOUNT_KEYS.flatMap((key) => {
    const hit = found.accounts[key]
    return hit && !cur.accounts[key].trim() ? [{ key, hit }] : []
  })
  return {
    ...cur,
    brand: cur.brand.trim() ? cur.brand : found.brand,
    website: found.website,
    accounts: { ...cur.accounts, ...Object.fromEntries(fills.map(({ key, hit }) => [key, hit.value])) },
    guessed: new Set([...cur.guessed, ...fills.filter(({ hit }) => hit.from === "guess").map(({ key }) => key)]),
  }
}

function sameAccounts(a: Readonly<Record<string, string | undefined>>, b: Readonly<Record<string, string | undefined>>): boolean {
  return COMPETITOR_ACCOUNT_KEYS.every((key) => (a[key] ?? "") === (b[key] ?? ""))
}

/**
 * What an edit changes, field by field. Sending an unchanged schedule would
 * restart the brand's schedule (its next scan moves a full period out), and
 * an unchanged account set is left alone too.
 */
export function changedFields(before: TrackedCompetitor, input: CreateCompetitorInput): UpdateCompetitorInput {
  const about = input.aboutPlatforms ?? []
  const sameAbout = about.length === before.aboutPlatforms.length && about.every((p) => before.aboutPlatforms.includes(p))
  return {
    ...(input.brand !== before.brand ? { brand: input.brand } : {}),
    ...(input.website !== undefined && input.website !== before.website ? { website: input.website } : {}),
    ...(input.accounts !== undefined && !sameAccounts(before.accounts, input.accounts) ? { accounts: input.accounts } : {}),
    ...(input.aboutPlatforms !== undefined && !sameAbout ? { aboutPlatforms: input.aboutPlatforms } : {}),
    ...(input.schedule !== undefined && input.schedule !== before.schedule ? { schedule: input.schedule } : {}),
    ...(input.isOwn !== undefined && input.isOwn !== before.isOwn ? { isOwn: input.isOwn } : {}),
  }
}

/** Track a brand (from its website or by hand), or change one. */
export function CompetitorFormDialog({
  open,
  editing,
  onOpenChange,
  onSubmit,
  busy,
}: {
  readonly open: boolean
  /** The brand being changed; null to add one. */
  readonly editing: TrackedCompetitor | null
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: (input: CreateCompetitorInput) => void
  readonly busy?: boolean
}) {
  const t = useT()
  const [form, setForm] = useState<CompetitorFormState>(emptyForm)
  const [finding, setFinding] = useState(false)
  // Bumped whenever the form is (re)filled or a lookup starts: a lookup that
  // answers after that belongs to another form, and is dropped.
  const lookup = useRef(0)

  useEffect(() => {
    lookup.current += 1
    setFinding(false)
    if (open) setForm(editing ? formFrom(editing) : emptyForm())
  }, [open, editing])

  const searches = competitorScanSearches({ accounts: form.accounts, aboutPlatforms: form.aboutPlatforms })
  // The price the scan is charged: the live price of this many searches, the
  // static table until it loads.
  const credits = useModelCredits(searches > 0 ? competitorScanCreditId(searches) : undefined, competitorScanCredits(searches))

  const findAccounts = async () => {
    const website = form.website.trim()
    if (!website) return
    const ticket = ++lookup.current
    setFinding(true)
    try {
      const found = await discoverCompetitor(website)
      if (ticket === lookup.current) setForm((cur) => mergeDiscovery(cur, found))
    } catch (err) {
      if (ticket === lookup.current) toast.error(err instanceof Error ? err.message : t("apiErr.discoverCompetitor"))
    } finally {
      if (ticket === lookup.current) setFinding(false)
    }
  }

  const toggleAbout = (p: CompetitorAboutPlatform) =>
    setForm((cur) => ({ ...cur, aboutPlatforms: cur.aboutPlatforms.includes(p) ? cur.aboutPlatforms.filter((x) => x !== p) : [...cur.aboutPlatforms, p] }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-3 sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{editing ? t("competitors.editTitle") : t("competitors.addTitle")}</DialogTitle>
          <DialogDescription>{t("competitors.formHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pe-1">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t("competitors.website")}
            <div className="flex gap-2">
              <Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder={t("competitors.phWebsite")} dir="ltr" />
              <Button type="button" variant="outline" onClick={() => void findAccounts()} disabled={finding || !form.website.trim()}>
                {finding ? <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" /> : <Search className="me-1 h-3.5 w-3.5" />}
                {t("competitors.findAccounts")}
              </Button>
            </div>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t("competitors.brand")}
            <Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} dir="auto" />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t("competitors.accounts")}</legend>
            {COMPETITOR_ACCOUNT_KEYS.map((key) => (
              <label key={key} className="flex items-center gap-2 text-[13px]">
                <span className="flex w-28 shrink-0 items-center gap-1.5 text-muted-foreground">
                  {SOCIAL_PLATFORM_META[key].icon("h-3.5 w-3.5")}
                  {SOCIAL_PLATFORM_META[key].name}
                </span>
                <Input
                  value={form.accounts[key]}
                  onChange={(e) => setForm({ ...form, accounts: { ...form.accounts, [key]: e.target.value }, guessed: new Set([...form.guessed].filter((g) => g !== key)) })}
                  placeholder={t(ACCOUNT_PLACEHOLDER[key])}
                  className="h-8"
                  dir="ltr"
                />
                {form.guessed.has(key) && <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-400">{t("competitors.guess")}</span>}
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium">{t("competitors.aboutPlatforms")}</legend>
            <div className="flex flex-wrap gap-1.5">
              {COMPETITOR_ABOUT_PLATFORMS.map((p) => {
                const on = form.aboutPlatforms.includes(p)
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => toggleAbout(p)}
                    aria-pressed={on}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-bold",
                      on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {SOCIAL_PLATFORM_META[p].icon("h-3.5 w-3.5")}
                    {SOCIAL_PLATFORM_META[p].name}
                  </button>
                )
              })}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              {t("competitors.schedule")}
              <select
                value={form.schedule}
                onChange={(e) => setForm({ ...form, schedule: e.target.value as CompetitorSchedule })}
                className="h-8 rounded-md border border-border bg-background px-2 text-[13px]"
              >
                {COMPETITOR_SCHEDULES.map((s) => (
                  <option key={s} value={s}>
                    {t(SCHEDULE_LABEL[s])}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isOwn} onChange={(e) => setForm({ ...form, isOwn: e.target.checked })} />
              {t("competitors.isOwn")}
            </label>
          </div>
        </div>
        <DialogFooter className="flex flex-wrap items-center gap-3 sm:justify-between">
          <span className="flex flex-wrap items-center gap-1 text-[12.5px] text-muted-foreground">
            {searches === 1 ? t("competitors.priceLineOne") : t("competitors.priceLine", { n: searches })}
            <CreditCost credits={credits} icon="sm" />
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => onSubmit(inputFrom(form))} disabled={busy || !form.brand.trim()}>
              {t("common.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
