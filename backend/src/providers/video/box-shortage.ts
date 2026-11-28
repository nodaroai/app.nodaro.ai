/**
 * The shortage retry as every runner uses it: `retryOnShortage` with the
 * kernel's count of refused processes and threads wired in.
 *
 * `ffmpeg-shortage-retry.ts` imports nothing (its mark is read by code that
 * must not load the /proc readers), so the real reader is handed to it here,
 * where the runners live. A runner that started a program through the bare
 * `retryOnShortage` would be back to judging a shortage by the program's words
 * alone — the launches that failed on 2026-11-25 saying only "Error while
 * opening encoder" — so `__tests__/box-shortage-census.test.ts` fails one that
 * does.
 */
import { processShortageObserver } from "../../lib/process-shortage.js"
import { retryOnShortage, type LaunchEvidence, type ShortageRetryOptions } from "./ffmpeg-shortage-retry.js"

/** Run a launch, and run it again while the box is short of processes or threads (`retryOnShortage`). */
export function retryOnBoxShortage<T>(
  attempt: (limitMs: number, evidence: LaunchEvidence) => Promise<T>,
  opts: Omit<ShortageRetryOptions, "kernel">,
): Promise<T> {
  return retryOnShortage(attempt, { ...opts, kernel: processShortageObserver() })
}
