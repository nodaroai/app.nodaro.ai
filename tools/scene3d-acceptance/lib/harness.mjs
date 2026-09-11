/**
 * The scaffolding every subcommand runs inside.
 *
 * It exists so the six probes differ only in WHAT they measure. Argument
 * parsing, the run id, the receipt's creation and its repeated re-writing, the
 * secret scan, the exit code and the shape of a failure are all decided once,
 * here — otherwise the first probe written under time pressure becomes the one
 * that forgets to persist evidence before the expensive step.
 *
 * Exit codes are part of the contract with whoever runs this from a shell:
 *   0  every assertion passed
 *   1  the run completed and an assertion FAILED (a real result, not an error)
 *   2  the harness itself broke (transport, bad arguments, a thrown error)
 *   3  this deployment cannot serve what the probe measures — nothing was run
 */
import { mkdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { parseSubcommandArgs, usage } from "./args.mjs"
import { HarnessError, newRunId } from "./client.mjs"
import { shortHash } from "./parity.mjs"
import { addNote, assert as recordAssertion, createReceipt, finalize, recordJob, writeReceipt } from "./receipt.mjs"

/** Flags whose VALUE is content the receipt records by digest, not verbatim. */
const REDACTED_VALUE_FLAGS = new Set(["--prompt", "--scoping-line", "--edit-prompt"])

/**
 * The command line, safe to commit.
 *
 * Recording `process.argv` verbatim would quietly undo the rest of the
 * receipt's discipline: `--prompt '<the whole brief>'` puts fixture text into a
 * file destined for a public tree, and a presigned media URL carries a live
 * `X-Amz-Signature` that the secret scanner has no pattern for. Content becomes
 * a digest and every URL becomes host + digest — enough to prove two runs used
 * the same input, not enough to be one.
 */
export function redactArgv(argv) {
  const out = []
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    out.push(token)
    if (REDACTED_VALUE_FLAGS.has(token) && i + 1 < argv.length) {
      out.push(`<sha ${shortHash(argv[++i])}>`)
      continue
    }
    if (/^https?:\/\//.test(token)) {
      out[out.length - 1] = redactUrl(token)
    }
  }
  return out
}

function redactUrl(raw) {
  const [url, fragment] = raw.split("#")
  let host = null
  try {
    host = new URL(url).host
  } catch {
    host = "unparseable"
  }
  return `<${host} sha ${shortHash(url)}>${fragment ? `#${fragment}` : ""}`
}

export const EXIT = Object.freeze({ pass: 0, fail: 1, error: 2, unavailable: 3 })

/**
 * Run one subcommand end to end.
 *
 * `main` is handed a context and returns nothing; everything it learns goes
 * into the receipt through `assert` / `note` / `record*`, and `save()` after
 * each material step. The rule the whole harness is built on: a run that dies
 * mid-flight must leave behind what it already knew, because the credits are
 * spent either way.
 */
export async function runSubcommand(name, argv, main) {
  let args
  try {
    args = parseSubcommandArgs(name, argv)
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage(name)}\n`)
    return EXIT.error
  }
  if (args.help) {
    process.stdout.write(`${usage(name)}\n`)
    return EXIT.pass
  }

  const runId = newRunId()
  const outDir = args.out
  const receipt = createReceipt({
    subcommand: name,
    runId,
    baseUrl: args.baseUrl ?? process.env.NODARO_BASE_URL ?? null,
    inputs: { label: args.label, argv: redactArgv(argv) },
  })
  const literals = [process.env.NODARO_API_KEY].filter((v) => typeof v === "string" && v.length >= 8)

  const log = (message) => process.stdout.write(`[${name}] ${message}\n`)
  const save = () => {
    if (args.dryRun) return null
    return writeReceipt(outDir, receipt, { literals })
  }
  const ctx = {
    name,
    runId,
    args,
    values: args.values,
    receipt,
    outDir,
    dryRun: args.dryRun,
    log,
    save,
    note: (text) => { addNote(receipt, text); return save() },
    assert: (assertionName, detail) => {
      const verdict = recordAssertion(receipt, assertionName, detail)
      log(`${verdict ? "PASS" : "FAIL"} ${assertionName}`)
      save()
      return verdict
    },
    recordJob: (job) => { const merged = recordJob(receipt, job); save(); return merged },
    workDir: () => {
      const dir = join(outDir, `work-${name}-${runId}`)
      mkdirSync(dir, { recursive: true })
      return dir
    },
  }

  if (!args.dryRun) mkdirSync(outDir, { recursive: true })

  try {
    await main(ctx)
    if (args.dryRun) {
      process.stdout.write(`${JSON.stringify({ dryRun: true, subcommand: name, runId, plan: receipt.inputs }, null, 2)}\n`)
      return EXIT.pass
    }
    finalize(receipt)
    const path = save()
    log(`${receipt.pass ? "PASSED" : "FAILED"} — ${receipt.assertions.filter((a) => a.pass).length}/${receipt.assertions.length} assertions — receipt ${path}`)
    return receipt.pass ? EXIT.pass : EXIT.fail
  } catch (error) {
    const unavailable = error instanceof HarnessError && error.code === "capability_unavailable"
    addNote(receipt, `${unavailable ? "unavailable" : "error"}: ${String(error?.message ?? error)}`)
    if (error instanceof HarnessError && error.hint) addNote(receipt, `hint: ${error.hint}`)
    receipt.error = { message: String(error?.message ?? error), code: error?.code ?? null, stack: null }
    if (!args.dryRun) {
      finalize(receipt, { status: unavailable ? "unavailable" : "error" })
      const path = save()
      log(`${unavailable ? "UNAVAILABLE" : "ERROR"} — ${error?.message ?? error} — receipt ${path}`)
    } else {
      process.stderr.write(`${error?.message ?? error}\n`)
    }
    return unavailable ? EXIT.unavailable : EXIT.error
  }
}

/** Wire a subcommand module up as a process. Used by the dispatcher. */
export async function executeAsProcess(name, argv, main) {
  const code = await runSubcommand(name, argv, main)
  process.exitCode = code
  return code
}

/**
 * The brief, from `--prompt` or `--prompt-file`.
 *
 * Fixture prompts are NOT embedded in this tree: the table prompt and the A/B
 * common prompt are acceptance fixtures owned by the plan repository, and a
 * second copy here — in a repository that is publicly mirrored — is both a
 * leak and a copy that can drift from the gate it is supposed to be.
 */
export async function resolvePrompt({ prompt, promptFile, fallbackFile, what }) {
  if (typeof prompt === "string" && prompt.trim() !== "") return { text: prompt.trim(), source: "--prompt" }
  const file = promptFile ?? fallbackFile
  if (typeof file === "string" && file !== "") {
    try {
      const text = await readFile(file, "utf8")
      if (text.trim() === "") throw new Error("the file is empty")
      return { text: text.trim(), source: file }
    } catch (error) {
      throw new HarnessError(`cannot read ${what} from ${file}: ${error?.message ?? error}`, {
        code: "no_prompt",
        hint: "see README.md — the fixture prompts are fetched from the plan repository, not committed here",
      })
    }
  }
  throw new HarnessError(`missing ${what} — pass --prompt or --prompt-file`, { code: "no_prompt" })
}
