"use client"

import { COMPETITOR_ABOUT_PLATFORMS, COMPETITOR_SCAN_SEARCH_LIMIT, type CreateCompetitorInput, type TrackedCompetitor } from "@nodaro/shared/social"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useT } from "@/lib/i18n"
import { AccountsFieldset, WebsiteField } from "./competitor-form-fields"
import { PlatformToggleGroup, ScanFormFooter, ScheduleSelect, togglePlatform } from "./scan-form-parts"
import { SearchTermsField } from "./search-terms-field"
import { useCompetitorForm } from "./use-competitor-form"

/** Track a brand (by hand, or with its accounts found from its website), or change one. */
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
  const f = useCompetitorForm(open, editing)
  const { form, setForm } = f
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-3 sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{editing ? t("competitors.editTitle") : t("competitors.addTitle")}</DialogTitle>
          <DialogDescription>{t("competitors.formHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pe-1">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t("competitors.brand")}
            <Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} dir="auto" />
          </label>
          <WebsiteField value={form.website} finding={f.finding} onChange={(website) => setForm({ ...form, website })} onFind={() => void f.findAccounts()} />
          <AccountsFieldset
            accounts={form.accounts}
            guessed={form.guessed}
            onChange={(key, value) => setForm({ ...form, accounts: { ...form.accounts, [key]: value }, guessed: new Set([...form.guessed].filter((g) => g !== key)) })}
          />
          <PlatformToggleGroup
            legend={t("competitors.aboutPlatforms")}
            platforms={COMPETITOR_ABOUT_PLATFORMS}
            selected={form.aboutPlatforms}
            onToggle={(p) => setForm((cur) => ({ ...cur, aboutPlatforms: togglePlatform(cur.aboutPlatforms, p) }))}
          />
          {f.limits && (
            <SearchTermsField
              terms={form.searchTerms}
              cap={f.cap}
              unlimited={f.unlimited}
              draft={f.termDraft}
              onDraft={f.setTermDraft}
              onChange={(searchTerms) => setForm((cur) => ({ ...cur, searchTerms }))}
            />
          )}
          <div className="flex flex-wrap items-center gap-4">
            <ScheduleSelect value={form.schedule} onChange={(schedule) => setForm({ ...form, schedule })} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isOwn} onChange={(e) => setForm({ ...form, isOwn: e.target.checked })} />
              {t("competitors.isOwn")}
            </label>
          </div>
        </div>
        {f.tooBig && (
          <p role="alert" className="text-[12px] text-destructive">
            {t("competitors.scanTooBig", { n: f.searches, max: COMPETITOR_SCAN_SEARCH_LIMIT })}
          </p>
        )}
        <ScanFormFooter
          priceText={f.pages === 1 ? t("competitors.priceLineOne") : t("competitors.priceLine", { n: f.pages })}
          credits={f.credits}
          saveDisabled={busy === true || !form.brand.trim() || f.tooBig}
          onCancel={() => onOpenChange(false)}
          onSave={() => onSubmit(f.input())}
        />
      </DialogContent>
    </Dialog>
  )
}
