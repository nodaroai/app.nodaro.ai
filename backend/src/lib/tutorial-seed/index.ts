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
// CLOUD IS EXCLUDED. Staging and production share one Supabase project, so
// anything that ran as a migration would also run against Cloud production,
// where these four templates already exist and belong to a real user. A boot
// seeder can be gated; a migration cannot.

import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { supabase } from "../supabase.js"
import { isCloud } from "../config.js"
import { isTransportError, withTransportRetry, type TransportRetryOptions } from "../boot-retry.js"
import { TUTORIAL_SYSTEM_EMAIL } from "../system-account.js"

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

interface TutorialTemplateDoc {
  slug: string
  name: string
  description?: string | null
  markdownDescription?: string | null
  category?: string
  outputTypes?: string[]
  tags?: string[]
  complexity?: string
  previewMediaUrl?: string | null
  previewMediaType?: string | null
  /** Looked up by slug — migration 114 seeds the categories themselves. */
  tutorialCategorySlug: string
  tutorialSortOrder: number
  nodes: unknown[]
  edges: unknown[]
  settings?: Record<string, unknown>
}

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
  // Everything a content update owns. `is_active` is deliberately absent: see
  // the insert below.
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
    creator_display_name: SYSTEM_NAME,
    node_count: doc.nodes.length,
    listed_in: ["tutorial"],
    // Migration 114's CHECK requires a category whenever 'tutorial' is listed.
    tutorial_category_id: categoryId,
    tutorial_sort_order: doc.tutorialSortOrder,
  }

  if (existing) {
    // CONTENT ONLY. An operator hides a tutorial (PATCH /v1/templates/:id
    // `isActive:false`, or the DELETE soft-delete) because the flow cannot run
    // on THIS installation — no provider balance, no key for that lane. That
    // is a decision about the deployment; a reworded tutorial carries no
    // information about it and must not overrule it. Sending `is_active: true`
    // here republished every hidden tutorial on the next content release.
    const { error } = await supabase.from("workflow_templates").update(row).eq("id", existing.id)
    if (error) throw error
    return "updated"
  }
  // A tutorial this installation has never seen starts visible.
  const { error } = await supabase.from("workflow_templates").insert({ ...row, is_active: true })
  if (error) throw error
  return "created"
}

/**
 * Idempotent, self-healing, and a no-op on Cloud. Never throws into boot: a
 * seeding failure must not take the server down, it just means no tutorials.
 *
 * Fired at API init (server.ts), which on the community stack is BEFORE the
 * container's own Caddy — the proxy every Supabase call here goes through —
 * is listening; the first call failed on every boot ("AuthRetryableFetchError:
 * fetch failed" from ensureSystemUser, 2026-08-16). The whole run is
 * idempotent, so a transport failure at any step retries the run on the
 * boot-retry schedule; an application error still skips at once.
 */
export async function seedTutorialTemplates(retry: TransportRetryOptions = {}): Promise<void> {
  if (isCloud()) return

  try {
    await withTransportRetry("tutorial-seed", runSeed, retry)
  } catch (err) {
    console.warn("[tutorial-seed] skipped:", err)
  }
}

async function runSeed(): Promise<void> {
  const docs = await loadDocs()
  if (docs.length === 0) return

  const userId = await ensureSystemUser()
  if (!userId) {
    console.warn("[tutorial-seed] could not resolve the system account — skipping")
    return
  }
  const projectId = await ensureSystemProject(userId)

  const counts = { created: 0, updated: 0, unchanged: 0 }
  for (const doc of docs) {
    try {
      counts[await seedOne(doc, userId, projectId)] += 1
    } catch (err) {
      // A dead proxy mid-run is not "one bad tutorial" — let the run retry.
      if (isTransportError(err)) throw err
      // One bad tutorial must not deny the others.
      console.warn(`[tutorial-seed] ${doc.slug} failed:`, err)
    }
  }
  if (counts.created || counts.updated) {
    console.log(
      `[tutorial-seed] ${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged`,
    )
  }
}
