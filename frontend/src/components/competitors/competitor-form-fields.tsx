"use client"

import { Loader2, Search } from "lucide-react"
import { COMPETITOR_ACCOUNT_KEYS, type CompetitorAccountKey } from "@nodaro/shared/social"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SOCIAL_PLATFORM_META } from "@/components/research/social-platforms"
import { useT, type MessageKey } from "@/lib/i18n"

const ACCOUNT_PLACEHOLDER: Readonly<Record<CompetitorAccountKey, MessageKey>> = {
  tiktok: "competitors.phHandle",
  instagram: "competitors.phHandle",
  youtube: "competitors.phChannel",
  x: "competitors.phHandle",
  linkedin: "competitors.phCompany",
  meta_ads: "competitors.phAdvertiser",
}

/** The brand's website (optional), with the lookup that finds its accounts from it. */
export function WebsiteField({
  value,
  finding,
  onChange,
  onFind,
}: {
  readonly value: string
  /** A lookup is on its way. */
  readonly finding: boolean
  readonly onChange: (website: string) => void
  readonly onFind: () => void
}) {
  const t = useT()
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {t("competitors.websiteOptional")}
      <div className="flex gap-2">
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={t("competitors.phWebsite")} dir="ltr" />
        <Button type="button" variant="outline" onClick={onFind} disabled={finding || !value.trim()}>
          {finding ? <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" /> : <Search className="me-1 h-3.5 w-3.5" />}
          {t("competitors.findAccounts")}
        </Button>
      </div>
    </label>
  )
}

/** The brand's accounts, one per platform, typed by hand or found from the website (a guess is marked). */
export function AccountsFieldset({
  accounts,
  guessed,
  onChange,
}: {
  readonly accounts: Readonly<Record<CompetitorAccountKey, string>>
  readonly guessed: ReadonlySet<CompetitorAccountKey>
  readonly onChange: (key: CompetitorAccountKey, value: string) => void
}) {
  const t = useT()
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{t("competitors.accounts")}</legend>
      {COMPETITOR_ACCOUNT_KEYS.map((key) => (
        <label key={key} className="flex items-center gap-2 text-[13px]">
          <span className="flex w-28 shrink-0 items-center gap-1.5 text-muted-foreground">
            {SOCIAL_PLATFORM_META[key].icon("h-3.5 w-3.5")}
            {SOCIAL_PLATFORM_META[key].name}
          </span>
          <Input value={accounts[key]} onChange={(e) => onChange(key, e.target.value)} placeholder={t(ACCOUNT_PLACEHOLDER[key])} className="h-8" dir="ltr" />
          {guessed.has(key) && <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-400">{t("competitors.guess")}</span>}
        </label>
      ))}
    </fieldset>
  )
}
