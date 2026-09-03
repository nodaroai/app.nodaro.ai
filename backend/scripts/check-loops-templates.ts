/**
 * Compare every admin → user template's compiled `dataVariableNames` against
 * what the Loops dashboard actually declares.
 *
 *   LOOPS_API_KEY=... npx tsx scripts/check-loops-templates.ts
 *   railway run --service <service> -- npx tsx scripts/check-loops-templates.ts
 *
 * WHY THIS EXISTS. The compiled list is the contract Loops validates every send
 * against: a variable it declares and we do not fill is a refused send, with an
 * error the admin sees as a bare 502 from a provider they cannot see. The unit
 * tests pin our half of that contract — that we always emit exactly the list,
 * never blank. Only this script can check the OTHER half, because the template
 * lives in a dashboard and can be edited by a person, at any time, with nothing
 * in this repository changing.
 *
 * Deliberately NOT a CI job: it needs a production API key, which public CI
 * does not have and must not. Run it after editing a template in Loops, and
 * when a send fails for a reason nobody can explain.
 */
import { ADMIN_MESSAGE_TEMPLATES } from "../src/ee/lib/admin-message-templates.js"

const API = "https://app.loops.so/api/v1/transactional?perPage=50"

interface LoopsTransactional {
  id?: unknown
  name?: unknown
  dataVariables?: unknown
}

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => (typeof v === "string" ? v : (v as { name?: unknown })?.name))
    .filter((v): v is string => typeof v === "string")
}

async function main(): Promise<number> {
  const key = (process.env.LOOPS_API_KEY ?? "").trim()
  if (!key) {
    console.log("LOOPS_API_KEY is not set — skipping (nothing to compare against).")
    return 0
  }

  const res = await fetch(API, { headers: { Authorization: `Bearer ${key}` } })
  if (!res.ok) {
    console.error(`Loops answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
    return 1
  }
  const body = (await res.json()) as { data?: LoopsTransactional[] } | LoopsTransactional[]
  const list = Array.isArray(body) ? body : (body.data ?? [])
  const declared = new Map<string, string[]>()
  for (const t of list) {
    if (typeof t.id === "string") declared.set(t.id, names(t.dataVariables))
  }

  let drift = 0
  for (const template of ADMIN_MESSAGE_TEMPLATES) {
    const live = declared.get(template.transactionalId)
    if (!live) {
      console.error(
        `✗ ${template.id}: no Loops template with id ${template.transactionalId}. ` +
          `Every send of this template fails.`,
      )
      drift++
      continue
    }
    const ours = new Set(template.dataVariableNames)
    const theirs = new Set(live)
    // Their extras are the dangerous direction: Loops refuses a send whose
    // declared variable we never fill.
    const unfilled = live.filter((n) => !ours.has(n))
    const unused = [...ours].filter((n) => !theirs.has(n))
    if (unfilled.length === 0 && unused.length === 0) {
      console.log(`✓ ${template.id}: ${live.join(", ")}`)
      continue
    }
    drift++
    console.error(`✗ ${template.id} (${template.transactionalId})`)
    if (unfilled.length > 0) {
      console.error(
        `    Loops declares but we never send: ${unfilled.join(", ")} ` +
          `— EVERY send of this template is refused until the template drops ` +
          `them or this code fills them.`,
      )
    }
    if (unused.length > 0) {
      console.error(
        `    we send but Loops does not declare: ${unused.join(", ")} ` +
          `— harmless today, but it means the two halves have drifted.`,
      )
    }
  }

  if (drift > 0) {
    console.error(`\n${drift} template(s) out of sync with the Loops dashboard.`)
    return 1
  }
  console.log("\nAll templates match the Loops dashboard.")
  return 0
}

// `exitCode`, not `process.exit()`: an abrupt exit while tsx still holds a
// handle open trips a libuv assertion on Windows, which reads like a crash in
// the very script you ran to diagnose one.
main().then(
  (code) => {
    process.exitCode = code
  },
  (err) => {
    console.error(err)
    process.exitCode = 1
  },
)
