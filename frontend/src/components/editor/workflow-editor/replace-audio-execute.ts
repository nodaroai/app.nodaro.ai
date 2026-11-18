/**
 * The canvas's own run of Replace Audio (Nodaro Cloud). The run itself is the
 * Cloud plugin's (`POST /v1/replace-audio`); the editor only builds the body
 * from the node's settings and what is wired into it, with the one rule both
 * engines use (`replaceAudioNodeBody`, @nodaro/render-rules), starts the job and
 * follows it like every other job-polling video node. A node the rule refuses
 * fails before anything is sent, in the person's language.
 *
 * The take lands with its speech, music and mix beside the video
 * (`runResultIdentity`, the mapping every landing lane applies).
 *
 * A leaf: the store, the client call and the poll are handed in by
 * execute-node.ts (`ReplaceAudioRunDeps`), so this module never imports the
 * workflow store or the API client and adds no edge to the store's import cycle.
 */
import { replaceAudioNodeBody, REPLACE_AUDIO_MUSIC_PROMPT_MAX, type ReplaceAudioBody, type ReplaceAudioNodeProblem } from "@nodaro/render-rules"
import { runResultIdentity } from "@/lib/run-result-identity"
import type { MessageKey } from "@/lib/i18n"
import type { ReplaceAudioNodeData, WorkflowNode } from "@/types/nodes"
import { nodeRunError } from "./node-run-message"
import type { pollJobWithNodeUpdate } from "./poll-job"
import type { ExecutionContext } from "./types"

/** Why a node is refused before its run, in the person's language. Typed by the codes, so a new one needs its words. */
const PROBLEM_KEYS: Readonly<Record<ReplaceAudioNodeProblem["code"], MessageKey>> = {
  "no-video": "nodeRun.replaceAudioNoVideo",
  "no-music": "nodeRun.replaceAudioNoMusic",
  "many-music": "nodeRun.replaceAudioManyMusic",
  "prompt-and-music": "nodeRun.replaceAudioPromptAndMusic",
  "no-prompt": "nodeRun.replaceAudioNoPrompt",
  "long-prompt": "nodeRun.replaceAudioLongPrompt",
}

/** A refusal as the node shows it: `Node "<label>": <why>`. */
export function replaceAudioProblemMessage(label: string | undefined, problem: ReplaceAudioNodeProblem): string {
  switch (problem.code) {
    case "many-music":
      return nodeRunError(label, PROBLEM_KEYS[problem.code], { count: problem.count })
    case "long-prompt":
      return nodeRunError(label, PROBLEM_KEYS[problem.code], { length: problem.length, max: REPLACE_AUDIO_MUSIC_PROMPT_MAX })
    default:
      return nodeRunError(label, PROBLEM_KEYS[problem.code])
  }
}

/** What the run reads off the wires: the video into `in`, every music source into `music` (node-input-resolver.ts). */
export interface ReplaceAudioWiredInputs {
  readonly videoUrl?: string
  readonly musicUrls?: readonly string[]
}

/** The run's collaborators, handed in by execute-node.ts. */
export interface ReplaceAudioRunDeps {
  /** The workflow store's node write. */
  readonly updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void
  /** The job poll every job-polling node runs through. */
  readonly poll: typeof pollJobWithNodeUpdate
  /** The client call that starts the run (`replaceAudio`, lib/api.ts). */
  readonly start: (body: ReplaceAudioBody) => Promise<{ jobId: string }>
  /** The run's error toast. */
  readonly toastError: (message: string) => void
}

export function executeReplaceAudio(node: WorkflowNode, inputs: ReplaceAudioWiredInputs, ctx: ExecutionContext, deps: ReplaceAudioRunDeps): Promise<string> {
  const d = node.data as ReplaceAudioNodeData
  const built = replaceAudioNodeBody(d, { videoUrl: inputs.videoUrl, musicUrls: inputs.musicUrls })
  if ("problem" in built) {
    const message = replaceAudioProblemMessage(d.label, built.problem)
    deps.updateNodeData(node.id, {
      executionStatus: "failed",
      errorMessage: message,
      errorHint: undefined,
      errorDetail: undefined,
      currentJobId: undefined,
      currentJobProgress: undefined,
    })
    deps.toastError(message)
    return Promise.reject(new Error(message))
  }
  return deps.poll(
    node.id,
    () => deps.start(built.body),
    "generatedVideoUrl",
    "Replace Audio",
    ctx,
    undefined,
    undefined,
    { resultFields: (od) => runResultIdentity("replace-audio", od) },
  )
}
