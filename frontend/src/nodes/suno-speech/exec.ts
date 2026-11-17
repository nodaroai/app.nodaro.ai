import { toast } from "sonner"
import { sunoSpeechProblem, sunoSpeechRun } from "@nodaro/render-rules"
import type { UnitExecKit, UnitExecutor } from "../exec-kit"
import { sunoSpeechApi } from "./api"
import { definition } from "./definition.generated"
import type { SunoSpeechData } from "./types"

// The editor's DAG executor: the mode's own fields (render-rules sunoSpeechRun,
// the rule the route and the server payload apply) → one job → two takes.
// Wired text is the mode's text: the brief in Brief mode, the script in Script
// mode. A run that cannot be sent stops here with the same sentence the
// server would answer.
export const executor: UnitExecutor = {
  execute(node, kit: UnitExecKit) {
    const d = node.data as SunoSpeechData
    const wired = typeof kit.inputs.prompt === "string" && kit.inputs.prompt.trim() !== "" ? kit.inputs.prompt : undefined
    const run = sunoSpeechRun({
      ...d,
      ...(wired !== undefined ? (d.mode === "script" ? { script: wired } : { prompt: wired }) : {}),
    })
    const problem = sunoSpeechProblem(run)
    if (problem) {
      toast.error(problem)
      return Promise.reject(new Error(problem))
    }
    kit.setUserPromptTemplate(run.mode === "brief" ? run.prompt : run.script)
    return kit.runProcessingNode(() => sunoSpeechApi(run, kit.userId), "generatedAudioUrl", definition.label)
  },
}
