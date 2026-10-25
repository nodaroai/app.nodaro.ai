import { useId } from "react"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useT } from "@/lib/i18n"

/** The same Long / Short / Max choice used by Recast, using this app's
 * existing accessible single-select primitive. */
export function VideoProSegmentPicker({value,onChange}:{value?:"long"|"short"|"max";onChange:(value:"long"|"short"|"max")=>void}) {
  const id=useId()
  const t=useT()
  return <div className="space-y-2 px-1">
    <div id={`${id}-label`} className="text-xs">{t("vidcfg.segmentMode")}</div>
    <RadioGroup aria-labelledby={`${id}-label`} value={value??""} orientation="horizontal" className="grid-cols-3 gap-1" onValueChange={next=>{
      if(next==="long"||next==="short"||next==="max") onChange(next)
    }}>
      {(["long","short","max"] as const).map(mode=><div key={mode} className="min-w-0">
        <RadioGroupItem id={`${id}-${mode}`} value={mode} className="peer sr-only"/>
        <label htmlFor={`${id}-${mode}`} title={t(`vidcfg.segmentMode.${mode}.hint`)} className="block cursor-pointer rounded-md border px-2 py-1.5 text-center text-xs peer-data-[state=checked]:border-primary/40 peer-data-[state=checked]:bg-primary/15 peer-data-[state=checked]:text-primary-ink peer-focus-visible:ring-2 peer-focus-visible:ring-ring">{t(`vidcfg.segmentMode.${mode}`)}</label>
      </div>)}
    </RadioGroup>
    {value&&<p className="text-[11px] text-muted-foreground">{t(`vidcfg.segmentMode.${value}.hint`)}</p>}
    {(value==="short"||value==="long")&&<p className="text-[11px] text-muted-foreground">{t("vidcfg.segmentMode.reserveHint")}</p>}
  </div>
}
