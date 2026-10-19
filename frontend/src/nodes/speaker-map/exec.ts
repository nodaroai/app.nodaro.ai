import { toast } from "sonner"
import { speakerMapRunInputs, speakerMapRunProblemText } from "@nodaro/render-rules"
import type { UnitExecKit, UnitExecutor } from "../exec-kit"
import { speakerMapApi } from "./api"

// The editor's DAG executor: 2–6 recordings + their offsets + a diarized
// transcript → a speaker-map job → its JSON outputs. The run's rules are the
// server's (speakerMapRunInputs, which payload.ts calls too): the same
// order, the same dropped master / wide, the same clamped lead, and the same
// refusals in the same words, before any request. The route re-checks each URL.
export const executor: UnitExecutor = {
  execute(node, kit: UnitExecKit) {
    const data = node.data as Readonly<Record<string, unknown>>
    const label = typeof data.label === "string" && data.label.trim() ? data.label : "Speaker Map"
    const run = speakerMapRunInputs(kit.inputs.unitInputs, data)
    if ("problem" in run) {
      const message = speakerMapRunProblemText(run.problem, { type: node.type ?? "", label })
      toast.error(message)
      return Promise.reject(new Error(message))
    }
    kit.setUserPromptTemplate(undefined)
    return kit.runJsonNode(() => speakerMapApi(run.body, kit.userId), "Speaker Map")
  },
}
