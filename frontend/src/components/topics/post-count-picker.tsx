"use client"

import { useId } from "react"
import { TOPIC_POST_COUNTS, type TopicPostCount } from "@nodaro/shared/social"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useT } from "@/lib/i18n"

const isPostCount = (value: number): value is TopicPostCount => (TOPIC_POST_COUNTS as readonly number[]).includes(value)

/** Posts each search reads (20, 40 or 60: one, two or three pages), as radios the arrow keys move between. */
export function PostCountPicker({ value, onChange }: { readonly value: TopicPostCount; readonly onChange: (count: TopicPostCount) => void }) {
  const t = useT()
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-sm font-medium">
        {t("topics.postCount")}
      </span>
      <RadioGroup
        value={String(value)}
        onValueChange={(next) => {
          const n = Number(next)
          if (isPostCount(n)) onChange(n)
        }}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
        className="flex flex-wrap gap-4"
      >
        {TOPIC_POST_COUNTS.map((n) => (
          <div key={n} className="flex items-center gap-1.5">
            <RadioGroupItem id={`${id}-${n}`} value={String(n)} />
            <Label htmlFor={`${id}-${n}`} className="text-[13px] font-normal tabular-nums">
              {t("topics.postCountOption", { n })}
            </Label>
          </div>
        ))}
      </RadioGroup>
      <span id={`${id}-hint`} className="text-[12px] text-muted-foreground">
        {t("topics.postCountHint")}
      </span>
    </div>
  )
}
