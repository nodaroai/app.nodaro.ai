import { Command } from "commander"
import { readFileSync, writeFileSync } from "node:fs"
import { buildCatalogSnapshot, type CatalogSnapshot } from "../lib/catalog-snapshot.js"
import { threeWayMergeCatalog } from "../lib/catalog-diff.js"
import { validatePackSidecars } from "../lib/catalog-validate.js"

/** `snapshot --in` payload: a detail=full /v1/catalogs catalog + its sidecars. */
interface SnapshotInput {
  projected: Parameters<typeof buildCatalogSnapshot>[0]
  sidecars?: Parameters<typeof buildCatalogSnapshot>[1]
}

const LOCALES = ["es", "fr", "de", "pt-BR", "ru", "hi", "ja", "ko", "zh-CN", "he", "ar"]
const read = (p: string) => JSON.parse(readFileSync(p, "utf8")) as CatalogSnapshot

export function catalogCommand(): Command {
  const cmd = new Command("catalog").description(
    "vendored-pack maintenance: snapshot, diff against upstream, validate sidecars (offline, file-based)",
  )

  cmd
    .command("snapshot")
    .description(
      "build a catalog snapshot (the diff-upstream/validate input shape) from a detail=full /v1/catalogs projection + its sidecars",
    )
    .requiredOption(
      "--in <file>",
      'JSON { "projected": <detail=full /v1/catalogs catalog>, "sidecars"?: <locale -> id -> {label?,description?}> }',
    )
    .action((o: { in: string }) => {
      const input = JSON.parse(readFileSync(o.in, "utf8")) as SnapshotInput
      const snapshot = buildCatalogSnapshot(input.projected, input.sidecars ?? {})
      process.stdout.write(JSON.stringify(snapshot, null, 2) + "\n")
    })

  cmd
    .command("diff-upstream")
    .description(
      "three-way merge: carry upstream edits for entries you left unmodified; never auto-admit new upstream entries",
    )
    .requiredOption("--baseline <file>", "upstream snapshot at vendoring time")
    .requiredOption("--upstream <file>", "current upstream snapshot")
    .requiredOption("--pack <file>", "your vendored pack snapshot")
    .option("--write <file>", "write the merge plan + next baseline to this path")
    .action((o: { baseline: string; upstream: string; pack: string; write?: string }) => {
      const plan = threeWayMergeCatalog(read(o.baseline), read(o.upstream), read(o.pack))
      const out = JSON.stringify(plan, null, 2)
      if (o.write) writeFileSync(o.write, out)
      else process.stdout.write(out + "\n")
      if (plan.conflicts.length) process.exitCode = 2
    })

  cmd
    .command("validate")
    .description("check a pack snapshot has sidecar coverage across 11 locales (or declared exemptions)")
    .requiredOption("--pack <file>", "your vendored pack snapshot")
    .option("--exempt <locales>", "comma-separated locales exempted from translation", "")
    .action((o: { pack: string; exempt: string }) => {
      const r = validatePackSidecars(
        read(o.pack),
        LOCALES,
        o.exempt
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      )
      process.stdout.write(JSON.stringify(r, null, 2) + "\n")
      if (!r.ok) process.exitCode = 1
    })

  return cmd
}
