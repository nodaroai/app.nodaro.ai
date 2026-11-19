/**
 * The platform's prices for every part of an Edit with AI run, at the length
 * of the video being edited, as the run is charged them. Read from the
 * server's price list, never written down here: the planning calls on their
 * model and effort, the transcription engine, the music, the image model the
 * b-roll is made with, the video editing model, face tracking, camera
 * switching, the edit plan, and the podcast pack that plans what is made.
 */
import { DEFAULT_SUNO_MODEL } from "@nodaro/shared/models"
import { sunoCreditType } from "@nodaro/shared/credits"
import { editPlanReserveCreditId } from "@nodaro/shared/edl"
import { SPEAKER_FRAMES_CREDIT_ID } from "@nodaro/render-rules"
import { useLlmPrice } from "@/hooks/use-llm-price"
import { useModelCreditCost } from "@/hooks/use-model-credit-cost"
import { useUnitQuote } from "@/hooks/use-unit-quote-credits"
import { editPlanPerMinuteReported, useEditPlanModes } from "@/lib/edit-plan-modes"
import type { EditPrices } from "@/ee/lib/freecut-ai/panel-model"
import { PLANNER_EFFORT, PLANNER_MODEL } from "@/ee/lib/freecut-ai/planner-prompt"
import { LISTEN_PROVIDER } from "@/ee/lib/freecut-ai/run/listen"
import { CREATIVE_EFFORT, CREATIVE_MODEL } from "@/ee/lib/freecut-ai/run/creative"
import { BROLL_IMAGE_MODEL, brollShots } from "@/ee/lib/freecut-ai/run/broll"
import { PICTURE_MAX_SECONDS, PICTURE_MODEL } from "@/ee/lib/freecut-ai/run/picture"
import { PACK_RATE_ID, packUnits } from "@/ee/lib/freecut-ai/run/pack"

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
  const mistakes = num(useModelCreditCost(length ? editPlanReserveCreditId("tighten", "economy", length, perMinute) : "").data)
  // Clips, the trailer and the chapters: one podcast pack for the video's length, whichever are asked.
  const pack = useUnitQuote(length ? PACK_RATE_ID : undefined, length ? packUnits(length) : 1)
  const blocks = length ? Math.max(1, Math.ceil((length * SAMPLES_PER_SECOND) / FRAMES_PER_BLOCK)) : 1
  // The whole run's price, as the server charges it: the blocks at the per-block rate, rounded up once.
  const tracking = useUnitQuote(length ? SPEAKER_FRAMES_CREDIT_ID : undefined, blocks)
  return {
    read: read.credits,
    readEstimate: read.estimate || choose.estimate,
    listen,
    choose: choose.credits,
    pack: length ? pack : undefined,
    brollPicture: image,
    steps: {
      mistakes: length ? mistakes : undefined,
      music,
      broll: image !== undefined && length ? image * brollShots(length) : undefined,
      picture: sum(trim, picture),
      phone: tracking,
      layout: tracking,
      cameras,
      // Vertical clips are framed on the face in the editor: their face tracking, beside the pack.
      clips: length ? tracking : undefined,
    },
  }
}
