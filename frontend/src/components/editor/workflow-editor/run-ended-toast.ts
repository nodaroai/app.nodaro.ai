import { countEmptyInputSkips, executionOutcome } from "@nodaro/shared/workflow"
import { ugcAwaitsPick } from "@nodaro/shared/ugc"
import { toast } from "sonner"
import { tx } from "@/lib/i18n"
import { executionErrorText } from "@/lib/execution-error-text"

/**
 * The toast for a backend run that ended `failed`, with the one action that
 * continues it from where it stopped (`continueFailedRun`, when the editor
 * offers it). The places a run's end reaches the editor (the stream's end, its
 * failed event, the poll, the final verification after a lost connection) all
 * call this, so the action is on every one of them.
 */
export function toastBackendRunFailed(
  executionId: string,
  errorMessage: string | null | undefined,
  continueFailedRun: ((executionId: string) => void) | undefined,
): void {
  toast.error(tx("run.backendFailed"), {
    description: executionErrorText(errorMessage),
    ...(continueFailedRun
      ? { duration: 12_000, action: { label: tx("continueFailed.action"), onClick: () => continueFailedRun(executionId) } }
      : {}),
  })
}

type SkipStateLike = { readonly status?: unknown; readonly skipReason?: unknown; readonly output?: unknown }

/**
 * The toast for a backend run that ended `completed`: "Pick your creator" when
 * the run stopped at a UGC Creator for the person's pick (everything after the
 * creator waits for it — never "completed"); "nothing new", with the number of
 * nodes skipped for want of input, when the run skipped one (a feed that found
 * no new posts, a writer with nothing to write — `executionOutcome`, the one
 * rule every surface asks); the plain success otherwise. The three places a
 * run's end reaches the editor (the stream's end, the poll, the final
 * verification after a lost connection) all call this.
 */
export function toastBackendRunCompleted(nodeStates: Readonly<Record<string, SkipStateLike>> | null | undefined): void {
  if (Object.values(nodeStates ?? {}).some((s) => s?.status === "completed" && ugcAwaitsPick(s.output))) {
    toast.info(tx("run.ugcPickCreator"), { description: tx("run.ugcPickCreatorDesc") })
    return
  }
  if (executionOutcome("completed", nodeStates) === "nothing_new") {
    const n = countEmptyInputSkips(nodeStates)
    toast.info(tx("run.backendNothingNew"), {
      description: n === 1 ? tx("run.backendNothingNewDescOne") : tx("run.backendNothingNewDesc", { n }),
    })
    return
  }
  toast.success(tx("run.backendCompleted"))
}
