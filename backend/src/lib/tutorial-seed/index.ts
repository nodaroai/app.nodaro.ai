// Seed the built-in guided tutorials into a self-hosted database.
//
// The tutorials are split across two substrates: the slug→body registry is CODE
// and ships in the image, while the tutorial itself is a `workflow_templates`
// ROW. Cloud has the rows; a fresh self-host has an empty database, so without
// this the Tutorials tab is empty and /tutorials/:slug 404s.
//
// Content lives in `./templates/*.json`, deliberately in `backend/` under the
// SUL: those snapshots embed the real prompts, and per the IP-placement rule
// creative content belongs here or in `@nodaro/prompts` — never in the Apache
// packages. Same call, and same reasoning, as `lib/demo-workflow.ts`.
//
// CLOUD IS EXCLUDED — for the BUILT-IN set. Staging and production share one
// Supabase project, so anything that ran as a migration would also run against
// Cloud production, where these four templates already exist and belong to a
// real user. A boot seeder can be gated; a migration cannot.
//
// Operator packs (NODARO_TUTORIAL_PACKS) are the one exception. A dedicated
// hosted instance runs EDITION=cloud against ITS OWN Supabase and ships its
// tutorials as a pack; on such an instance the seeder seeds the packs and
// nothing else. Nodaro's shared cloud never sets the env, so it still returns
// before a single Supabase call — see seedTutorialTemplates.

import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { supabase } from "../supabase.js"
import { isCloud } from "../config.js"
import { isTransportError, withTransportRetry, type TransportRetryOptions } from "../boot-retry.js"
import { TUTORIAL_SYSTEM_EMAIL } from "../system-account.js"
import { loadTutorialPacks, parsePackDirList } from "./packs.js"
import type { TutorialPackCategory, TutorialTemplateDoc } from "./types.js"

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), "templates")

/**
 * The account that owns built-in tutorials.
 *
 * Not the first human to sign up: `workflow_templates.workflow_id` is
 * `ON DELETE CASCADE`, so a user tidying away workflows they never created
 * would silently delete the installation's tutorials. A dedicated owner also
 * makes the seeder self-healing — every path back to "missing" (deleted user,
 * workflow or template row) is repaired on the next boot, which is impossible
 * once a per-user claim like `profiles.demo_seeded_at` has been burned.
 *
 * Never loginable: created with the service role, no usable password, and
 * nothing in the flow ever authenticates as it.
 */
// The identity lives in lib/system-account.ts so first-run logic (the setup
// screen's hasUsers) can exclude it without knowing about this seeder.
const SYSTEM_EMAIL = TUTORIAL_SYSTEM_EMAIL
const SYSTEM_NAME = "Nodaro"

/** Content fingerprint. Stored on the row so a reworded tutorial actually
 *  reaches installations that already seeded an older copy — an insert-only
 *  seeder would freeze whatever shipped first. */
function fingerprint(doc: TutorialTemplateDoc): string {
  return createHash("sha256")
    .update(JSON.stringify({ ...doc, fingerprint: undefined }))
    .digest("hex")
    .slice(0, 16)
}

async function loadDocs(): Promise<TutorialTemplateDoc[]> {
  let entries: string[]
  try {
    entries = await readdir(TEMPLATES_DIR)
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      // tsc emits JS only — the templates reach dist/ via
      // scripts/copy-build-assets.mjs, which every build entry point runs.
      // A missing directory means a build path skipped it; say so instead of
      // surfacing a bare ENOENT that reads like a filesystem hiccup.
      throw new Error(
        `templates directory missing at ${TEMPLATES_DIR} — the build did not run ` +
          `scripts/copy-build-assets.mjs (npm run build does; a raw tsc invocation must add it). ` +
          `No tutorials will be seeded until it does.`,
      )
    }
    throw err
  }
  const files = entries.filter((f) => f.endsWith(".json"))
  const docs: TutorialTemplateDoc[] = []
  for (const file of files) {
    docs.push(JSON.parse(await readFile(join(TEMPLATES_DIR, file), "utf8")) as TutorialTemplateDoc)
  }
  return docs.sort((a, b) => a.slug.localeCompare(b.slug))
}

/** Find or create the owning account. The `handle_new_user` trigger creates the
 *  matching profile row, so nothing else is needed here. */
async function ensureSystemUser(): Promise<string | null> {
  const { data: list, error: listError } = await supabase.auth.admin.listUsers({ perPage: 200 })
  if (listError) throw listError
  const existing = list.users.find((u) => u.email === SYSTEM_EMAIL)
  if (existing) return existing.id

  const { data, error } = await supabase.auth.admin.createUser({
    email: SYSTEM_EMAIL,
    email_confirm: true,
    user_metadata: { full_name: SYSTEM_NAME, is_system_account: true },
  })
  if (error) throw error
  return data.user?.id ?? null
}

/** The project the seeded workflows live in. Mirrors `ensureDefaultProject`,
 *  which depends on `auth.uid()` and so cannot be used under the service role. */
async function ensureSystemProject(userId: string): Promise<string> {
  const { data: found } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle()
  if (found?.id) return found.id as string

  const { data, error } = await supabase
    .from("projects")
    .insert({ user_id: userId, name: "Tutorials" })
    .select("id")
    .single()
  if (error) throw error
  return data.id as string
}

async function categoryIdBySlug(slug: string): Promise<string | null> {
  const { data } = await supabase
    .from("tutorial_categories")
    .select("id")
    .eq("slug", slug)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

/**
 * Ensure a pack-declared category exists (data, not a migration). Select-then-
 * insert, mirroring ensureSystemProject: an existing slug is a no-op; a new one
 * is created so the pack's templates satisfy migration 114's CHECK ('tutorial'
 * in listed_in REQUIRES a category). Returns false on failure so the caller can
 * skip that pack rather than let N per-template CHECK violations fire.
 */
async function ensureTutorialCategory(cat: TutorialPackCategory): Promise<boolean> {
  const existing = await categoryIdBySlug(cat.slug)
  if (existing) return true
  const { error } = await supabase
    .from("tutorial_categories")
    .insert({ slug: cat.slug, name: cat.name, sort_order: cat.sortOrder ?? 0, description: cat.description ?? null })
  if (error) {
    console.warn(`[tutorial-seed] could not ensure category ${cat.slug}:`, error)
    return false
  }
  return true
}

/**
 * Columns the INSTALLATION owns — never sent by a content update.
 *
 * A tutorial gets switched off, or taken out of the Tutorials tab, because the
 * flow cannot run on THIS box: no provider balance, no key for that lane. That
 * is a statement about the deployment, and a reworded tutorial carries no
 * information about it, so a reseed must leave it alone. Both columns used to
 * ride in the shared upsert payload and were rewritten on every content
 * release.
 *
 * `listed_in` is an extensible tag array ('tutorial', 'marketplace', …), so
 * rewriting it wholesale also dropped any other tag an admin had added.
 *
 * Presentation stays content-owned: name, description, the snapshot, and the
 * tutorial's category and sort order all still come from the shipped doc — a
 * release is entitled to re-word and re-order the set it ships.
 *
 * Exported so the seeder's own test can assert structurally that no UPDATE
 * payload carries any of these, which is what catches the NEXT column added
 * to the shared literal.
 */
export const OPERATOR_OWNED_COLUMNS: readonly string[] = ["is_active", "listed_in"]

/**
 * What a tutorial this installation has never seen starts as: visible, and
 * listed in the Tutorials tab. Applied on INSERT only — see above.
 */
const SEEDED_DEFAULTS = {
  is_active: true,
  listed_in: ["tutorial"],
}

async function seedOne(
  doc: TutorialTemplateDoc,
  userId: string,
  projectId: string,
): Promise<"created" | "updated" | "unchanged"> {
  const hash = fingerprint(doc)

  // Scoped to this owner on purpose: a template with the same slug created by a
  // real user must never be overwritten by the seeder.
  const { data: existing } = await supabase
    .from("workflow_templates")
    .select("id, workflow_id, markdown_description")
    .eq("slug", doc.slug)
    .eq("creator_id", userId)
    .maybeSingle()

  // The fingerprint rides in markdown_description's leading marker line so the
  // seeder needs no schema change of its own.
  const marker = `<!-- seed:${hash} -->`
  if (existing && typeof existing.markdown_description === "string" &&
      existing.markdown_description.startsWith(marker)) {
    return "unchanged"
  }

  const workflowPayload = {
    user_id: userId,
    project_id: projectId,
    name: doc.name,
    nodes: doc.nodes,
    edges: doc.edges,
    settings: doc.settings ?? {},
  }

  let workflowId = existing?.workflow_id as string | undefined
  if (workflowId) {
    await supabase.from("workflows").update(workflowPayload).eq("id", workflowId)
  } else {
    const { data, error } = await supabase
      .from("workflows")
      .insert(workflowPayload)
      .select("id")
      .single()
    if (error) throw error
    workflowId = data.id as string
  }

  const categoryId = await categoryIdBySlug(doc.tutorialCategorySlug)
  // Everything a content update owns. Every OPERATOR_OWNED_COLUMNS entry is
  // deliberately absent — they are applied on the insert below and never
  // resent.
  const row = {
    workflow_id: workflowId,
    creator_id: userId,
    slug: doc.slug,
    name: doc.name,
    description: doc.description ?? null,
    // Marker first so the next boot can tell whether this copy is current.
    markdown_description: `${marker}\n${doc.markdownDescription ?? ""}`,
    snapshot_nodes: doc.nodes,
    snapshot_edges: doc.edges,
    snapshot_settings: doc.settings ?? {},
    category: doc.category ?? "other",
    output_types: doc.outputTypes ?? [],
    tags: doc.tags ?? [],
    complexity: doc.complexity ?? "simple",
    preview_media_url: doc.previewMediaUrl ?? null,
    preview_media_type: doc.previewMediaType ?? null,
    // The column the UI shows, so the system account's email never surfaces.
    // A pack can override attribution (doc.creatorDisplayName, stamped from the
    // manifest — see loadTutorialPacks); base templates fall back to the owner.
    creator_display_name: doc.creatorDisplayName ?? SYSTEM_NAME,
    node_count: doc.nodes.length,
    // Money/facet metadata the Tutorials tab renders on the card. Authored on
    // the doc (estimated credits cannot be derived in core — the credit engine
    // is EE). Absent → the same DB defaults the columns already carry.
    estimated_credits: doc.estimatedCredits ?? 0,
    node_types_used: doc.nodeTypesUsed ?? [],
    providers_used: doc.providersUsed ?? [],
    // Migration 114's CHECK is one-directional — 'tutorial' in listed_in
    // REQUIRES a category, not the reverse — so writing the category while
    // leaving listed_in alone is safe whether or not the tag is still there.
    tutorial_category_id: categoryId,
    tutorial_sort_order: doc.tutorialSortOrder,
  }

  if (existing) {
    // CONTENT ONLY — see OPERATOR_OWNED_COLUMNS. Sending those here
    // republished every hidden tutorial, and re-listed every un-listed one,
    // on the next content release.
    //
    // Which lever reaches which column is worth knowing. `listed_in` is
    // written by the admin-only tutorial-flag route
    // (PATCH /v1/admin/workflow-templates/:id/tutorial-flag), which gates on
    // role and does NOT check ownership — so it reaches a seeded row and is
    // the reachable half of this bug. `is_active` is NOT reachable that way:
    // the generic template routes (PATCH /v1/templates/:id and the DELETE
    // soft-delete) both require `creator_id === userId`, and these rows belong
    // to the never-loginable system account, so both 403. It arrives from the
    // back office instead — direct SQL, a support script, or an admin lever
    // added later. Preserving it is what makes any of those safe.
    const { error } = await supabase.from("workflow_templates").update(row).eq("id", existing.id)
    if (error) throw error
    return "updated"
  }
  const { error } = await supabase
    .from("workflow_templates")
    .insert({ ...row, ...SEEDED_DEFAULTS })
  if (error) throw error
  return "created"
}

/**
 * Idempotent, self-healing, and a no-op on Cloud unless operator packs are
 * configured (header). Never throws into boot: a seeding failure must not take
 * the server down, it just means no tutorials.
 *
 * Fired at API init (server.ts), which on the community stack is BEFORE the
 * container's own Caddy — the proxy every Supabase call here goes through —
 * is listening; the first call failed on every boot ("AuthRetryableFetchError:
 * fetch failed" from ensureSystemUser, 2026-08-16). The whole run is
 * idempotent, so a transport failure at any step retries the run on the
 * boot-retry schedule; an application error still skips at once.
 */
export async function seedTutorialTemplates(retry: TransportRetryOptions = {}): Promise<void> {
  // Cloud seeds operator packs only; with none configured there is nothing to
  // do, and returning here keeps Nodaro's shared cloud byte-identical (no
  // system account, no Supabase call).
  if (isCloud() && !packsConfigured()) return

  try {
    await withTransportRetry("tutorial-seed", runSeed, retry)
  } catch (err) {
    console.warn("[tutorial-seed] skipped:", err)
  }
}

/** Read at call time, like loadTutorialPacks, so a test can flip the env. */
function packsConfigured(): boolean {
  return parsePackDirList(process.env.NODARO_TUTORIAL_PACKS).length > 0
}

async function runSeed(): Promise<void> {
  // The built-in set is loaded on every edition, but SEEDED only off Cloud
  // (header). On Cloud its slugs still feed the pack de-dup below, so a pack
  // can never shadow a built-in a real user already owns there.
  const docs = await loadDocs()
  const seedBuiltIns = !isCloud()
  if (!seedBuiltIns && !packsConfigured()) return
  if (docs.length === 0 && !packsConfigured()) return

  const userId = await ensureSystemUser()
  if (!userId) {
    console.warn("[tutorial-seed] could not resolve the system account — skipping")
    return
  }
  const projectId = await ensureSystemProject(userId)

  const counts = { created: 0, updated: 0, unchanged: 0 }
  const seedDoc = async (doc: TutorialTemplateDoc) => {
    try {
      counts[await seedOne(doc, userId, projectId)] += 1
    } catch (err) {
      // A dead proxy mid-run is not "one bad tutorial" — let the run retry.
      if (isTransportError(err)) throw err
      // One bad tutorial must not deny the others.
      console.warn(`[tutorial-seed] ${doc.slug} failed:`, err)
    }
  }

  if (seedBuiltIns) for (const doc of docs) await seedDoc(doc)

  // Operator-supplied packs (business/self-host, or a dedicated Cloud instance). loadTutorialPacks has already
  // validated + de-duplicated them against the base slugs; a malformed pack was
  // skipped whole and logged. Ensure each pack's categories before its docs so
  // the migration-114 tutorial-requires-category CHECK never fires.
  const baseSlugs = new Set(docs.map((d) => d.slug))
  const packs = await loadTutorialPacks({ baseSlugs })
  for (const pack of packs) {
    let categoriesOk = true
    for (const cat of pack.categories) {
      if (!(await ensureTutorialCategory(cat))) categoriesOk = false
    }
    if (!categoriesOk) {
      console.warn(`[tutorial-seed] pack ${pack.name}: a category could not be ensured — skipping its tutorials`)
      continue
    }
    for (const doc of pack.docs) await seedDoc(doc)
  }

  if (counts.created || counts.updated) {
    console.log(
      `[tutorial-seed] ${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged`,
    )
  }
}
