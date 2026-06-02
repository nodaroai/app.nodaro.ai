import { Command } from "commander"
import type { WizardSelection } from "@nodaro/shared"
import { buildClient, handleError } from "../client.js"
import { emit, info, success, dim, table, warn, type OutputOpts } from "../output.js"
import { parseSelectionPairs } from "../params.js"
import { collectVariadic } from "../util.js"
import { isInteractive, pickFromList, pickManyFromList, ask } from "../interactive.js"
import { pickNodeInteractively } from "./nodes.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

interface WizardOpts extends GlobalOpts {
  nodeType?: string
  prompt?: string
  provider?: string
  style?: string
  aspectRatio?: string
  duration?: number
  llmModel?: string
}

/** The provider/style/aspect/duration/model fields every action passes through. */
function commonWizardFields(opts: WizardOpts) {
  return {
    provider: opts.provider,
    style: opts.style,
    aspectRatio: opts.aspectRatio,
    duration: opts.duration,
    llmModel: opts.llmModel,
  }
}

export function promptCommand(): Command {
  const cmd = new Command("prompt").description(
    "AI prompt wizard — analyze, generate, and enhance prompts for generation nodes",
  )

  cmd
    .command("wizard")
    .description("interactive: answer guided questions and get an optimized prompt")
    .option("--node-type <type>", "target node type (omit for an interactive picker)")
    .option("--prompt <text>", "your rough idea (optional)")
    .option("--provider <name>")
    .option("--style <name>")
    .option("--aspect-ratio <ratio>")
    .option("--duration <seconds>", "clip duration in seconds", (v) => parseInt(v, 10))
    .option("--llm-model <id>")
    .option("--profile <name>")
    .action(async (opts: WizardOpts) => {
      try {
        if (!isInteractive()) {
          warn("`prompt wizard` needs an interactive terminal — use `prompt analyze` + `prompt generate`, or `prompt enhance`, in scripts.")
          process.exit(2)
        }
        const client = buildClient(opts.profile)
        const nodeType = opts.nodeType ?? (await pickNodeInteractively(client))
        const common = commonWizardFields(opts)
        const { questions } = await client.promptHelper.analyze({ nodeType, prompt: opts.prompt, ...common })

        const CUSTOM = "__custom__"
        const selections: WizardSelection[] = []
        for (const q of questions) {
          if (q.multi) {
            const picked = await pickManyFromList<string>({
              message: q.label,
              choices: q.options.map((o) => ({
                name: o.label,
                value: o.value,
                description: o.description,
                checked: Array.isArray(q.selected) ? q.selected.includes(o.value) : false,
              })),
            })
            for (const v of picked) selections.push({ category: q.category, value: v, isCustom: false })
          } else {
            const choices = q.options.map((o) => ({ name: o.label, value: o.value, description: o.description }))
            if (q.allowCustom) choices.push({ name: "Custom…", value: CUSTOM, description: "type your own" })
            const chosen = await pickFromList<string>({
              message: q.label,
              choices,
              default: typeof q.selected === "string" ? q.selected : undefined,
            })
            if (chosen === CUSTOM) {
              const custom = await ask({ message: `${q.label} (custom)`, required: true })
              selections.push({ category: q.category, value: custom, isCustom: true })
            } else {
              selections.push({ category: q.category, value: chosen, isCustom: false })
            }
          }
        }

        const result = await client.promptHelper.generate({ nodeType, selections, originalPrompt: opts.prompt, ...common })
        success("optimized prompt:")
        info(result.prompt)
        if (result.recommendedModel) {
          dim(`recommended: ${result.recommendedModel.label} — ${result.recommendedModel.reason}`)
        }
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("analyze")
    .description("return guided questions for a rough prompt idea")
    .requiredOption("--node-type <type>")
    .option("--prompt <text>")
    .option("--provider <name>")
    .option("--style <name>")
    .option("--aspect-ratio <ratio>")
    .option("--duration <seconds>", "clip duration in seconds", (v) => parseInt(v, 10))
    .option("--llm-model <id>")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: WizardOpts) => {
      try {
        const client = buildClient(opts.profile)
        const { jobId, questions } = await client.promptHelper.analyze({
          nodeType: opts.nodeType as string,
          prompt: opts.prompt,
          ...commonWizardFields(opts),
        })
        if (opts.json) {
          emit({ jobId, questions }, opts)
          return
        }
        table(
          questions.map((q) => ({
            category: q.category,
            label: q.label,
            options: q.options.map((o) => o.value).join(", "),
            multi: q.multi ?? false,
          })),
          ["category", "label", "options", "multi"],
        )
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("generate")
    .description("build an optimized prompt from --selection category=value flags")
    .requiredOption("--node-type <type>")
    .option("--selection <pairs...>", "category=value (repeat); custom answers are wizard-only", collectVariadic)
    .option("--original-prompt <text>")
    .option("--provider <name>")
    .option("--style <name>")
    .option("--aspect-ratio <ratio>")
    .option("--duration <seconds>", "clip duration in seconds", (v) => parseInt(v, 10))
    .option("--llm-model <id>")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: WizardOpts & { selection?: string[]; originalPrompt?: string }) => {
      try {
        const client = buildClient(opts.profile)
        const selections = parseSelectionPairs(opts.selection)
        if (selections.length === 0) throw new Error("at least one --selection category=value is required")
        const result = await client.promptHelper.generate({
          nodeType: opts.nodeType as string,
          selections,
          originalPrompt: opts.originalPrompt,
          ...commonWizardFields(opts),
        })
        if (opts.json) {
          emit(result, opts)
          return
        }
        info(result.prompt)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("enhance")
    .description("rewrite a rough idea into one optimized prompt (no questions)")
    .requiredOption("--node-type <type>")
    .option("--prompt <text>")
    .option("--provider <name>")
    .option("--style <name>")
    .option("--aspect-ratio <ratio>")
    .option("--duration <seconds>", "clip duration in seconds", (v) => parseInt(v, 10))
    .option("--llm-model <id>")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: WizardOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.promptHelper.enhance({
          nodeType: opts.nodeType as string,
          prompt: opts.prompt,
          ...commonWizardFields(opts),
        })
        if (opts.json) {
          emit(result, opts)
          return
        }
        info(result.prompt)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}
