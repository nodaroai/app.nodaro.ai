"use client"

/**
 * The content rights box every link import shows: a checkbox with the short
 * line, and the declaration's full text (read from the server, shared by every
 * box on the page) unfolding on request. The box owns no state: who ticks it,
 * for which link, and what the tick starts is the caller's — the Video URL
 * node's controller on the canvas, the app runner's card on its page.
 */
import { useId, useState } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { reloadDeclaration, useRightsDeclaration } from "@/lib/content-rights"
import { useT } from "@/lib/i18n"

export interface RightsDeclarationBoxProps {
  readonly checked: boolean
  readonly disabled?: boolean
  readonly onCheckedChange: (checked: boolean) => void
  /** The text size of the surface (`text-xs`, `text-[11px]`). */
  readonly textClass?: string
  /** Keeps pointer and key events inside the box — on the canvas they would drag the node. */
  readonly contained?: boolean
}

const STOP = (e: { stopPropagation(): void }) => e.stopPropagation()

export function RightsDeclarationBox({ checked, disabled, onCheckedChange, textClass = "text-xs", contained }: RightsDeclarationBoxProps) {
  const t = useT()
  const declaration = useRightsDeclaration()
  const [open, setOpen] = useState(false)
  const boxId = useId()
  const contain = contained ? { onMouseDown: STOP, onKeyDown: STOP } : {}

  if (declaration.status === "failed") {
    return (
      <div className={`flex flex-wrap items-center gap-2 ${textClass}`} {...contain}>
        <span className="text-red-500">{t("videolink.rightsLoadFailed")}</span>
        <button type="button" className="nodrag underline" onClick={(e) => { e.stopPropagation(); reloadDeclaration() }}>
          {t("common.tryAgain")}
        </button>
      </div>
    )
  }
  if (declaration.status === "loading") {
    return <p className={`${textClass} text-muted-foreground`}>{t("videolink.rightsLoading")}</p>
  }
  return (
    <div className="flex flex-col gap-1" {...contain}>
      <label htmlFor={boxId} className={`nodrag flex items-start gap-2 ${textClass} text-foreground cursor-pointer`}>
        <Checkbox
          id={boxId}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onCheckedChange(value === true)}
          className="mt-0.5"
        />
        <span>{t("videolink.rightsConfirm")}</span>
      </label>
      <button
        type="button"
        className={`nodrag self-start underline ${textClass} text-muted-foreground`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        {open ? t("videolink.rightsHide") : t("videolink.rightsRead")}
      </button>
      {open && <p className={`${textClass} text-muted-foreground whitespace-pre-wrap`}>{declaration.declaration.text}</p>}
    </div>
  )
}
