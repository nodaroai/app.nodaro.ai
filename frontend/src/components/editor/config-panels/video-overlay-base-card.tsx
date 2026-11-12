// frontend/src/components/editor/config-panels/video-overlay-base-card.tsx
"use client"

import { useT } from "@/lib/i18n"
import type { VideoOverlayBox, VideoOverlayBoxInput, VideoOverlayCanvas } from "@nodaro/shared/video"
import { Section } from "./panel-section"
import { VideoOverlayBoxFields } from "./video-overlay-box-fields"

/**
 * What the base card offers: no box without an output aspect; under a stack
 * the layout places it; with no box of its own Video fit places it (nothing
 * to edit until a move gives it one); else its box — the stored one, or an
 * edge layout's — as fields.
 */
export type VideoOverlayBaseCardState =
  | { readonly kind: "needs-aspect" }
  /** `customBlocked`: Custom cannot be chosen yet (the stack's shapes are unread): the card neither points at it nor offers a move. */
  | { readonly kind: "by-stack"; readonly customBlocked: boolean }
  | { readonly kind: "by-fit" }
  | { readonly kind: "box"; readonly box: VideoOverlayBox; readonly summary: string }

/**
 * The Base video card: the base's box in a Custom layer's fields (anchor,
 * offsets, width, height, fit), written through the layers writer — the same
 * box the stage's base drag writes. Reset removes a stored box (Video fit
 * places the base again). Without an output aspect it says a base box needs
 * one (`base_box_needs_aspect`); under a stack it says the layout places the
 * base (Custom converts it). Its "Move on the preview" control is the ONE way
 * the base is selected — then it can be dragged and resized on the stage; an
 * unselected base takes no pointer there. The card is part of the base for
 * "a press outside it" (`data-video-overlay-base`).
 */
export function VideoOverlayBaseCard({
  state,
  stored,
  canvas,
  marker,
  selected,
  onSelect,
  onPatch,
  onReset,
}: {
  state: VideoOverlayBaseCardState
  /** A base box is stored (Reset is offered). */
  stored: boolean
  canvas?: VideoOverlayCanvas
  /** The node id: ties the card to its base for "a press outside it". */
  marker: string
  /** The base is selected: movable on the stage. */
  selected: boolean
  onSelect: (on: boolean) => void
  onPatch: (patch: VideoOverlayBoxInput) => void
  onReset: () => void
}) {
  const t = useT()
  return (
    <section
      className={`rounded-md border p-2 space-y-2 ${selected ? "border-[#ff0073]" : "border-border/60"}`}
      aria-label={t("proccfg.videoOverlay.baseCard.title")}
      data-video-overlay-base={marker}
    >
      <div className="flex items-center justify-between gap-1 px-0.5">
        <span className="text-xs font-medium">{t("proccfg.videoOverlay.baseCard.title")}</span>
        <div className="flex gap-1">
          {(state.kind === "box" || state.kind === "by-fit" || (state.kind === "by-stack" && !state.customBlocked)) && (
            <button
              type="button"
              aria-pressed={selected}
              className={`h-6 px-2 rounded-md border text-[11px] ${selected ? "bg-cta border-cta text-white" : "border-border/60 hover:bg-muted"}`}
              title={t("proccfg.videoOverlay.baseCard.selectHint")}
              onClick={() => onSelect(!selected)}
            >
              {t("proccfg.videoOverlay.baseCard.select")}
            </button>
          )}
          {stored && (
            <button
              type="button"
              className="h-6 px-2 rounded-md border border-border/60 text-[11px] hover:bg-muted"
              title={t("proccfg.videoOverlay.baseCard.resetHint")}
              onClick={onReset}
            >
              {t("proccfg.videoOverlay.baseCard.reset")}
            </button>
          )}
        </div>
      </div>
      {state.kind === "needs-aspect" && <p className="text-[11px] text-muted-foreground px-0.5">{t("proccfg.videoOverlay.baseCard.needsAspect")}</p>}
      {state.kind === "by-stack" && (
        <p className="text-[11px] text-muted-foreground px-0.5">{t(state.customBlocked ? "proccfg.videoOverlay.baseCard.byLayoutWaiting" : "proccfg.videoOverlay.baseCard.byLayout")}</p>
      )}
      {state.kind === "by-fit" && <p className="text-[11px] text-muted-foreground px-0.5">{t("proccfg.videoOverlay.baseCard.byFit")}</p>}
      {state.kind === "box" && (
        <Section title={t("proccfg.videoOverlay.placement")} summary={state.summary} defaultOpen={false}>
          <p className="text-[11px] text-muted-foreground">{t("proccfg.videoOverlay.baseCard.hint")}</p>
          <VideoOverlayBoxFields idPrefix="vo-base" box={state.box} canvas={canvas} anchorHint={t("proccfg.videoOverlay.baseCard.anchorHint")} menuMarker={marker} onPatch={onPatch} />
        </Section>
      )}
    </section>
  )
}
