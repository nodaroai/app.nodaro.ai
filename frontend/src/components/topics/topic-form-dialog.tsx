"use client"

import { useEffect, useId, useState } from "react"
import { COMPETITOR_SEARCH_TERM_MAX_LENGTH, TOPIC_PLATFORMS, TOPIC_SCAN_PAGE_CREDIT_ID, topicScanPages, type CreateTopicInput, type TrackedTopic } from "@nodaro/shared/social"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { PlatformToggleGroup, ScanFormFooter, ScheduleSelect, togglePlatform } from "@/components/competitors/scan-form-parts"
import { useScanPagesPrice } from "@/components/competitors/scan-price"
import { useT } from "@/lib/i18n"
import { PostCountPicker } from "./post-count-picker"
import { TOPIC_NAME_MAX_LENGTH, emptyTopicForm, topicFormFrom, topicInputFrom, type TopicFormState } from "./topic-form"

/** The topic's name and the hashtag or phrase it searches (the name when left empty). */
function TopicNameFields({ form, onChange }: { readonly form: TopicFormState; readonly onChange: (change: Partial<TopicFormState>) => void }) {
  const t = useT()
  const id = useId()
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-name`} className="text-sm font-medium">
          {t("topics.name")}
        </label>
        <Input id={`${id}-name`} value={form.name} onChange={(e) => onChange({ name: e.target.value })} maxLength={TOPIC_NAME_MAX_LENGTH} dir="auto" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-term`} className="text-sm font-medium">
          {t("topics.term")}
        </label>
        <Input
          id={`${id}-term`}
          value={form.term}
          onChange={(e) => onChange({ term: e.target.value })}
          placeholder={form.name.trim() || t("topics.phTerm")}
          maxLength={COMPETITOR_SEARCH_TERM_MAX_LENGTH}
          aria-describedby={`${id}-term-hint`}
          dir="auto"
        />
        <span id={`${id}-term-hint`} className="text-[12px] text-muted-foreground">
          {t("topics.termHint")}
        </span>
      </div>
    </>
  )
}

/** Follow a hashtag or phrase, or change one. */
export function TopicFormDialog({
  open,
  editing,
  onOpenChange,
  onSubmit,
  busy,
}: {
  readonly open: boolean
  /** The topic being changed; null to add one. */
  readonly editing: TrackedTopic | null
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: (input: CreateTopicInput) => void
  readonly busy?: boolean
}) {
  const t = useT()
  const [form, setForm] = useState<TopicFormState>(emptyTopicForm)
  useEffect(() => {
    if (open) setForm(editing ? topicFormFrom(editing) : emptyTopicForm())
  }, [open, editing])
  const change = (next: Partial<TopicFormState>) => setForm((cur) => ({ ...cur, ...next }))
  const pages = topicScanPages({ platforms: form.platforms, postCount: form.postCount })
  const credits = useScanPagesPrice(TOPIC_SCAN_PAGE_CREDIT_ID, pages)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-3 sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{editing ? t("topics.editTitle") : t("topics.addTitle")}</DialogTitle>
          <DialogDescription>{t("topics.formHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pe-1">
          <TopicNameFields form={form} onChange={change} />
          <PlatformToggleGroup legend={t("topics.platforms")} platforms={TOPIC_PLATFORMS} selected={form.platforms} onToggle={(p) => setForm((cur) => ({ ...cur, platforms: togglePlatform(cur.platforms, p) }))}>
            {form.platforms.length === 0 && <span className="text-[12px] text-amber-700 dark:text-amber-400">{t("topics.pickPlatform")}</span>}
          </PlatformToggleGroup>
          <PostCountPicker value={form.postCount} onChange={(postCount) => change({ postCount })} />
          <ScheduleSelect value={form.schedule} onChange={(schedule) => change({ schedule })} />
        </div>
        <ScanFormFooter
          priceText={pages === 1 ? t("topics.priceLineOne") : t("topics.priceLine", { n: pages })}
          credits={credits}
          saveDisabled={busy === true || !form.name.trim() || form.platforms.length === 0}
          onCancel={() => onOpenChange(false)}
          onSave={() => onSubmit(topicInputFrom(form))}
        />
      </DialogContent>
    </Dialog>
  )
}
