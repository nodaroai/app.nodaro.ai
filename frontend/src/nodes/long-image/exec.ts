import { toast } from "sonner"
import { longImageMode, longImageProblem, longImageRun, longImageWiredPictures } from "@nodaro/render-rules"
import type { UnitExecKit, UnitExecutor } from "../exec-kit"
import { longImageApi } from "./api"
import { definition } from "./definition.generated"
import type { LongImageData } from "./types"

// The editor's DAG executor: the mode's own settings and pictures (render-rules
// longImageRun / longImageWiredPictures, the rules the route and the server
// payload apply) → one job → one tall picture. Wired text wins over the node's
// own prompt. Each picture comes from the input it is wired to (the image lane,
// `unitInputs`): a list driving the node is resolved per item on that input,
// so the iteration's media override, which names no input, is not read. A run
// that cannot be sent stops here with the sentence the server would answer.
export const executor: UnitExecutor = {
  execute(node, kit: UnitExecKit) {
    const d = node.data as LongImageData
    const wired = typeof kit.inputs.prompt === "string" && kit.inputs.prompt.trim() !== "" ? kit.inputs.prompt : undefined
    const mode = longImageMode(d.mode)
    const { pictures, problem: pictureProblem } = longImageWiredPictures(kit.inputs.unitInputs, mode)
    // The node's own settings (only those: a picture is never read off its data) and its wired pictures.
    const run = longImageRun({ mode, length: d.length, resolution: d.resolution, prompt: wired ?? d.prompt, ...pictures })
    const problem = pictureProblem ?? longImageProblem(run)
    if (problem) {
      toast.error(problem)
      return Promise.reject(new Error(problem))
    }
    kit.setUserPromptTemplate(run.prompt)
    return kit.runProcessingNode(() => longImageApi(run, kit.userId), "generatedImageUrl", definition.label)
  },
}
