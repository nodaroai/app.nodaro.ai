/**
 * The platform's prices for every part of an Edit with AI run, at the length
 * of the video being edited, as the run is charged them. Read from the
 * server's price list, never written down here: the planning calls on their
 * model and effort, the transcription engine, the music, the image model the
 * b-roll is made with, the video editing model, face tracking, camera
 * switching, the edit plans, and the canvas nodes' fixed fees for what is made.
 */
import { DEFAULT_SUNO_MODEL } from "@nodaro/shared/models"
import { sunoCreditType } from "@nodaro/shared/credits"
import { editPlanReserveCreditId } from "@nodaro/shared/edl"
import { SPEAKER_FRAMES_CREDIT_ID } from "@nodaro/render-rules"
import { useLlmPrice } from "@/hooks/use-llm-price"
import { useModelCreditCost } from "@/hooks/use-model-credit-cost"
import { useUnitQuote } from "@/hooks/use-unit-quote-credits"
import { editPlanPerMinuteReported, isEditPlanModeSupported, useEditPlanModes } from "@/lib/edit-plan-modes"
import type { EditPrices } from "@/ee/lib/freecut-ai/panel-model"
import { PLANNER_EFFORT, PLANNER_MODEL } from "@/ee/lib/freecut-ai/planner-prompt"
import { LISTEN_PROVIDER } from "@/ee/lib/freecut-ai/run/listen"
import { CREATIVE_EFFORT, CREATIVE_MODEL } from "@/ee/lib/freecut-ai/run/creative"
import { BROLL_IMAGE_MODEL, brollShots } from "@/ee/lib/freecut-ai/run/broll"
import { PICTURE_MAX_SECONDS, PICTURE_MODEL } from "@/ee/lib/freecut-ai/run/picture"
import { makeFeeType } from "@/ee/lib/freecut-ai/run/make"

const MUSIC_CREDIT_ID = sunoCreditType(DEFAULT_SUNO_MODEL, "suno-generate")
const CAMERA_SWITCH_ID = "camera-switch"
/** Trim Video is charged per started five seconds of what it keeps: the changed shot is at most ten. */
const TRIM_ID = "trim-video"
const TRIM_UNIT_SECONDS = 5
/** Face tracking is charged per started block of this many sampled frames, sampled 2 a second. */
const FRAMES_PER_BLOCK = 1000
const SAMPLES_PER_SECOND = 2

const num = (v: unknown) => (typeof v === "number" ? v : undefined)
const sum = (...parts: Array<number | undefined>) => (parts.every((p) => p !== undefined) ? parts.reduce<number>((a, b) => a + (b ?? 0), 0) : undefined)

export function useEditPrices(seconds: number | undefined): EditPrices & { readonly readEstimate: boolean; readonly brollPicture?: number } {
  useEditPlanModes()
  const perMinute = editPlanPerMinuteReported()
  const read = useLlmPrice("llm-structured", PLANNER_MODEL, PLANNER_EFFORT)
  const choose = useLlmPrice("llm-structured", CREATIVE_MODEL, CREATIVE_EFFORT)
  const listen = num(useModelCreditCost(LISTEN_PROVIDER).data)
  const music = num(useModelCreditCost(MUSIC_CREDIT_ID).data)
  const image = num(useModelCreditCost(BROLL_IMAGE_MODEL).data)
  const picture = num(useModelCreditCost(PICTURE_MODEL).data)
  const trim = useUnitQuote(TRIM_ID, Math.ceil(PICTURE_MAX_SECONDS / TRIM_UNIT_SECONDS))
  const cameras = num(useModelCreditCost(CAMERA_SWITCH_ID).data)
  const length = seconds && seconds > 0 ? seconds : undefined
  const planId = (mode: "tighten" | "clips" | "trailer" | "chapters") => (length ? editPlanReserveCreditId(mode, "economy", length, perMinute) : "")
  const mistakes = num(useModelCreditCost(planId("tighten")).data)
  const clipsPlan = num(useModelCreditCost(planId("clips")).data)
  const trailerPlan = num(useModelCreditCost(planId("trailer")).data)
  const chaptersPlan = num(useModelCreditCost(planId("chapters")).data)
  const clipsFee = num(useModelCreditCost(`use-case-fee:${makeFeeType("clips")}`).data)
  const trailerFee = num(useModelCreditCost(`use-case-fee:${makeFeeType("trailer")}`).data)
  const chaptersFee = num(useModelCreditCost(`use-case-fee:${makeFeeType("chapters")}`).data)
  const blocks = length ? Math.max(1, Math.ceil((length * SAMPLES_PER_SECOND) / FRAMES_PER_BLOCK)) : 1
  // The whole run's price, as the server charges it: the blocks at the per-block rate, rounded up once.
  const tracking = useUnitQuote(length ? SPEAKER_FRAMES_CREDIT_ID : undefined, blocks)
  return {
    read: read.credits,
    readEstimate: read.estimate || choose.estimate,
    listen,
    choose: choose.credits,
    brollPicture: image,
    steps: {
      mistakes: length ? mistakes : undefined,
      music,
      broll: image !== undefined && length ? image * brollShots(length) : undefined,
      picture: sum(trim, picture),
      phone: tracking,
      layout: tracking,
      cameras,
      // Vertical clips are framed on the face: tracking is part of their price.
      clips: length ? sum(clipsPlan, clipsFee, tracking) : undefined,
      // A server that cannot plan a trailer picks its moments in the creative pass.
      trailer: length ? (isEditPlanModeSupported("trailer") ? sum(trailerPlan, trailerFee) : sum(choose.credits, trailerFee)) : undefined,
      chapters: length ? sum(chaptersPlan, chaptersFee) : undefined,
    },
  }
}
