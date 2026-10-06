/**
 * This process's ffmpeg admission: the queue (`ffmpeg-admission.ts`) wired to
 * the config, the memory budget and the container's shared ledger (decided
 * 2026-10-05). `ffmpeg-utils.ts` is the one caller.
 *
 * `FFMPEG_MEMORY_LEDGER=redis` (default) shares ONE memory budget across the
 * container's processes through Redis; `local` gives this process the whole
 * budget alone (one process per container, tests). The Redis client is loaded
 * on the first launch, never at import.
 */
import { config } from "../../lib/config.js"
import { FfmpegAdmission, type AdmissionWaitObserver } from "./ffmpeg-admission.js"
import { ContainerMemoryGate, LocalMemoryGate, type MemoryGate, type ReserveOutcome } from "./ffmpeg-memory-gate.js"
import { RedisMemoryLedger } from "./ffmpeg-memory-ledger.js"
import { describeFfmpegMemoryBudget, ffmpegMemoryBudgetOnThisBox, type FfmpegMemoryBudget } from "./ffmpeg-memory.js"
import { defaultPeakMemoryMiB } from "./ffmpeg-memory-model.js"
import { ffmpegEffectiveThreads } from "./ffmpeg-threads.js"

/** This box's ffmpeg memory budget (read once — `ffmpeg-memory.ts`). */
export function ffmpegMemoryBudgetNow(): FfmpegMemoryBudget {
  return ffmpegMemoryBudgetOnThisBox({
    fallbackLimitMiB: config.FFMPEG_MEMORY_LIMIT_MIB,
    reserveMiB: config.FFMPEG_MEMORY_RESERVE_MIB,
    headroom: config.FFMPEG_MEMORY_HEADROOM,
    defaultPeakMiB: config.FFMPEG_DEFAULT_PEAK_MIB,
    localShare: config.FFMPEG_MEMORY_LOCAL_SHARE,
  })
}

/** What a launch that predicts nothing reserves: the operator's fixed figure,
 *  else the thread-scaled estimate for the counts it will run with. */
export function defaultLaunchPeakMiB(): number {
  return ffmpegMemoryBudgetNow().defaultPeakOverrideMiB ?? defaultPeakMemoryMiB(ffmpegEffectiveThreads())
}

/** The container's gate, built on first use: the Redis client is imported then
 *  (a failure to build it leaves the gate on its local share, once logged). */
class LazyContainerGate implements MemoryGate {
  private gate: Promise<MemoryGate> | undefined

  tryReserve(peakMiB: number, budgetMiB: number): Promise<ReserveOutcome> {
    this.gate ??= this.build()
    return this.gate.then((gate) => gate.tryReserve(peakMiB, budgetMiB))
  }

  private async build(): Promise<MemoryGate> {
    const localShare = () => ffmpegMemoryBudgetNow().localShare
    try {
      const { createFfmpegMemoryLedger } = await import("../../lib/ffmpeg-memory-redis.js")
      const { ledger, containerId, containerIdSource } = await createFfmpegMemoryLedger()
      console.log(`[ffmpeg-memory] shared ledger for container ${containerId} (${containerIdSource}); ${describeFfmpegMemoryBudget(ffmpegMemoryBudgetNow())}`)
      return new ContainerMemoryGate({ ledger, localShare })
    } catch (error) {
      // Cannot even build the client: every decision is the local share.
      const reason = error instanceof Error ? error.message : String(error)
      const never = new RedisMemoryLedger({
        containerId: "unavailable",
        client: () => {
          throw new Error(`ledger client unavailable: ${reason}`)
        },
      })
      return new ContainerMemoryGate({ ledger: never, localShare })
    }
  }
}

function buildGate(): MemoryGate {
  // Anything but an explicit "redis" (a config stub, a test) is the local gate.
  return config.FFMPEG_MEMORY_LEDGER === "redis" ? new LazyContainerGate() : new LocalMemoryGate()
}

// Built on first use, not at import: reading the config at import time would
// break every test that stubs it (and nothing needs the admission before a launch).
let ffmpegAdmission: FfmpegAdmission | undefined
function admission(): FfmpegAdmission {
  ffmpegAdmission ??= new FfmpegAdmission(
    () => {
      const memory = ffmpegMemoryBudgetNow()
      return { slots: config.FFMPEG_CONCURRENCY, budgetMiB: memory.budgetMiB, defaultPeakMiB: defaultLaunchPeakMiB }
    },
    { gate: buildGate() },
  )
  return ffmpegAdmission
}

/** Wait until a launch of `peakMemoryMiB` may start; resolves with its release. */
export function acquireFfmpegSlot(
  signal: AbortSignal | undefined,
  peakMemoryMiB: number | undefined,
  observer: AdmissionWaitObserver | undefined,
): Promise<() => void> {
  return admission().acquire({ peakMemoryMiB, signal, observer })
}
