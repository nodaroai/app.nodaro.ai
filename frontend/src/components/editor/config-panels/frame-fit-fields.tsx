import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  FRAME_FITS,
  FRAME_DELIVERIES,
  DEFAULT_FRAME_FIT,
  DEFAULT_FRAME_DELIVERY,
  resolveFrameDelivery,
  resolveOutputCanvas,
  type FrameFit,
  type FrameDelivery,
} from "@nodaro/shared/video"
import {
  getModel,
} from "@nodaro/shared/model-catalog"
import { planFrameDelivery } from "@nodaro/prompts/assembly"
import { useT } from "@/lib/i18n"

/**
 * Start/end frame handling — two selects that only exist while a frame is
 * wired. `frameFit` is how much of the frame we reshape before sending (the
 * model's MEASURED output canvas by default — a frame at any other size is
 * reshaped by the provider instead, visibly on Seedance 2.5); `frameDelivery`
 * is whether the frame travels as a frame or as a prompt-bound reference
 * image (`auto` only switches the Seedance 2.0 family, whose frame mode
 * measured worse). Delivery is hidden on models with no reference-image
 * support — the backend collapses it to `frame` there anyway.
 *
 * Both selects read as their default when unset, and the auto option names
 * what it resolves to for the selected model, so no explanatory prose is
 * needed. The one hint line is the concrete canvas, shown only when the
 * (model, resolution, aspect) trio has been measured.
 */

/** Does the model accept reference images at all? Same test the backend runs. */
export function supportsReferenceDelivery(provider: string | undefined): boolean {
  if (!provider) return false
  const features = getModel(provider)?.features
  // A keyframes model's reference images are in-between FRAMES — a frame
  // delivered as a reference would become one (mirrors video-frame-dispatch.ts).
  return Boolean(features?.includes("reference-image") && !features.includes("keyframes"))
}

/** Is a persisted value one this select can render? Anything else is stale. */
export function isFrameFit(v: unknown): v is FrameFit {
  return typeof v === "string" && (FRAME_FITS as readonly string[]).includes(v)
}
export function isFrameDelivery(v: unknown): v is FrameDelivery {
  return typeof v === "string" && (FRAME_DELIVERIES as readonly string[]).includes(v)
}

/**
 * What the run will actually do with the frames.
 *
 * A thin adapter over `planFrameDelivery` (@nodaro/prompts) — the SAME function
 * the backend dispatch calls (`lib/video-frame-dispatch.ts`). The panel used to
 * re-implement the composition, which meant the resolved-mode indicator could
 * drift from the request it describes; an indicator that lies is worse than no
 * indicator, so both ends read one plan.
 */
export function previewFrameDelivery(args: {
  provider: string | undefined
  requested: FrameDelivery | undefined
  hasStartFrame: boolean
  hasEndFrame: boolean
  userRefCount: number
  prompt?: string
}): { delivery: Exclude<FrameDelivery, "auto">; promptSuffix: string } {
  const plan = planFrameDelivery({
    provider: args.provider,
    requested: args.requested,
    supportsReferenceImages: supportsReferenceDelivery(args.provider),
    // The panel knows THAT a frame is wired, not its url yet — the planner only
    // needs presence and ordering, so stand-ins carry the shape faithfully.
    startFrameUrl: args.hasStartFrame ? "frame:start" : undefined,
    endFrameUrl: args.hasEndFrame ? "frame:end" : undefined,
    userReferenceUrls: Array.from({ length: Math.max(0, args.userRefCount) }, (_, i) => `ref:${i}`),
    prompt: args.prompt,
  })
  return { delivery: plan.delivery, promptSuffix: plan.promptSuffix }
}

export interface FrameFitFieldsProps {
  provider: string | undefined
  resolution: string | undefined
  aspectRatio: string | undefined
  frameFit: FrameFit | undefined
  frameDelivery: FrameDelivery | undefined
  /** A start OR end frame is wired. Nothing renders without one. */
  hasFrame: boolean
  onUpdate: (u: { frameFit?: FrameFit; frameDelivery?: FrameDelivery }) => void
  /** Element-id prefix so the two panels that mount this never collide. */
  idPrefix?: string
}

export function FrameFitFields({ provider, resolution, aspectRatio, frameFit, frameDelivery, hasFrame, onUpdate, idPrefix = "" }: FrameFitFieldsProps) {
  const t = useT()
  if (!hasFrame) return null

  const fit = isFrameFit(frameFit) ? frameFit : DEFAULT_FRAME_FIT
  const delivery = isFrameDelivery(frameDelivery) ? frameDelivery : DEFAULT_FRAME_DELIVERY
  const showDelivery = supportsReferenceDelivery(provider)
  const autoResolvesTo = resolveFrameDelivery({ provider, requested: "auto", supportsReferenceImages: true })
  // Only a measured trio yields a number; an open aspect (`adaptive`/`Auto`)
  // is snapped from the image at run time, which the panel cannot see.
  const canvas = fit === "resolution" ? resolveOutputCanvas(provider, resolution, aspectRatio) : undefined

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}frameFit`} className="text-xs">{t("vidcfg.frameFit")}</Label>
        <Select value={fit} onValueChange={(v) => onUpdate({ frameFit: v as FrameFit })}>
          <SelectTrigger id={`${idPrefix}frameFit`} aria-label={t("vidcfg.frameFit")} className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="resolution">{t("vidcfg.frameFitResolution")}</SelectItem>
            <SelectItem value="ratio">{t("vidcfg.frameFitRatio")}</SelectItem>
            <SelectItem value="original">{t("vidcfg.frameFitOriginal")}</SelectItem>
          </SelectContent>
        </Select>
        {canvas && (
          <p className="text-[11px] text-muted-foreground px-1">
            {t("vidcfg.frameFitCanvasHint", { width: canvas[0], height: canvas[1] })}
          </p>
        )}
      </div>
      {showDelivery && (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}frameDelivery`} className="text-xs">{t("vidcfg.frameDelivery")}</Label>
          <Select value={delivery} onValueChange={(v) => onUpdate({ frameDelivery: v as FrameDelivery })}>
            <SelectTrigger id={`${idPrefix}frameDelivery`} aria-label={t("vidcfg.frameDelivery")} className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                {autoResolvesTo === "reference" ? t("vidcfg.frameDeliveryAutoReference") : t("vidcfg.frameDeliveryAutoFrame")}
              </SelectItem>
              <SelectItem value="frame">{t("vidcfg.frameDeliveryFrame")}</SelectItem>
              <SelectItem value="reference">{t("vidcfg.frameDeliveryReference")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}
