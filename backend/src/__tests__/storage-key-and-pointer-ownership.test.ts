/**
 * Rows that name storage keys, and rows that point at another user's things
 * (decided 2026-10-06; migration 480).
 *
 * A row says where a file is, not whose it is. Before 480 a signed-in browser
 * could insert an `assets` row, or write a location, creature or object, naming
 * ANY storage key — and the storage reapers and permanent deletes then deleted
 * that key on the row owner's behalf. A job's `pipeline_id` and
 * `parent_job_id` were the same kind of pointer, written by the browser before
 * 474 and read back by the server with the service role.
 *
 * Five guards:
 *   1. 480 takes every write on the four content tables, and `characters`, away
 *      from the browser roles (nothing in this repo, studio, the extension or
 *      the cloud plugins writes them from a browser), and no later migration
 *      gives one back. The SECURITY DEFINER functions that edit those rows lose
 *      the browser roles' EXECUTE too, and `share_workflow_assets` is dropped.
 *   2. The database keeps the pointer invariant itself: rows planted along
 *      `jobs.pipeline_id`, `jobs.parent_job_id` and `assets.pipeline_id` are
 *      detached, and triggers refuse a cross-user pointer for every writer.
 *   3. Every backend read of `jobs` (or `assets`) through one of those pointers
 *      also filters `user_id`.
 *   4. A pipeline entity's asset pointers (`main_asset_id`,
 *      `metadata.last_attempted_asset_id`, `last_frame_asset_id`) and a
 *      variant's `asset_id` (decided 2026-10-07), and the asset ids inside a
 *      scene's `metadata.scene_node_data` (round 3, decided 2026-10-07), name
 *      only the pipeline owner's assets: rows written before 480 are counted,
 *      not changed, a trigger refuses a new cross-user pointer, and every
 *      backend file that reads one resolves it through
 *      `lib/pipeline-asset-ownership.ts` (or is listed with why it resolves
 *      none).
 *   5. Every backend file that deletes storage objects either asks
 *      `lib/key-ownership.ts` whose they are, or deletes only keys the server
 *      itself made (listed below, with why).
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const REPO_ROOT = join(__dirname, "..", "..", "..")
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations")
const BACKEND_SRC = join(REPO_ROOT, "backend", "src")
const LOCK_MIGRATION = "480_storage_key_and_pointer_ownership.sql"

/** `characters` joined the four in the decisions round (decided 2026-10-07). */
const CONTENT_TABLES = ["assets", "locations", "creatures", "objects", "characters"] as const

/** SQL without `--` comments, whitespace collapsed, lower-cased. */
function sqlOf(file: string): string {
  return readFileSync(join(MIGRATIONS_DIR, file), "utf8")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase()
}

function versionOf(file: string): number {
  return Number(/^(\d+)_/.exec(file)?.[1] ?? NaN)
}

function laterMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && versionOf(f) > versionOf(LOCK_MIGRATION))
}

/** The body of the LAST migration that defines `fn` — the definition in force. */
function latestDefinitionOf(fn: string): { file: string; body: string } | null {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && Number.isFinite(versionOf(f)))
    .sort((a, b) => versionOf(a) - versionOf(b))
  let found: { file: string; body: string } | null = null
  const head = new RegExp(`create or replace function (?:public\\.)?${fn}\\(`)
  for (const file of files) {
    const text = sqlOf(file)
    const at = text.search(head)
    if (at === -1) continue
    const rest = text.slice(at)
    const open = rest.indexOf("$$")
    const close = rest.indexOf("$$", open + 2)
    found = { file, body: rest.slice(0, rest.indexOf(";", close) + 1) }
  }
  return found
}

function lockSql(): string {
  return sqlOf(LOCK_MIGRATION)
}

describe("the content tables that name storage keys: the browser roles write nothing", () => {
  for (const table of CONTENT_TABLES) {
    it(`${table}: INSERT, UPDATE, DELETE and TRUNCATE are revoked from anon and authenticated`, () => {
      expect(lockSql()).toMatch(
        new RegExp(`revoke insert, update, delete, truncate on public\\.${table} from anon, authenticated;`),
      )
    })

    it(`${table}: the browser's read stays (SELECT is not revoked)`, () => {
      expect(lockSql()).not.toMatch(new RegExp(`revoke [^;]*\\bselect\\b[^;]* on public\\.${table}\\b`))
    })

    it(`${table}: no later migration grants a write back or adds a permissive write policy`, () => {
      for (const file of laterMigrations()) {
        const text = sqlOf(file)
        expect(text, `${file} grants a write on ${table}`).not.toMatch(
          new RegExp(
            `grant [^;]*\\b(insert|update|delete|truncate|all)\\b[^;]* on (table )?(public\\.)?${table} to [^;]*\\b(anon|authenticated|public)\\b`,
          ),
        )
        expect(text, `${file} adds a permissive write policy on ${table}`).not.toMatch(
          new RegExp(`create policy [^;]* on (public\\.)?${table} (as permissive )?for (insert|update|delete|all)`),
        )
      }
      for (const file of laterMigrations()) {
        expect(sqlOf(file), `${file} grants writes on every table`).not.toMatch(
          /grant [^;]* on all tables in schema public to [^;]*\b(anon|authenticated|public)\b/,
        )
      }
    })
  }

  it("characters keeps its one FOR ALL policy (it also serves SELECT); without the grants it admits no write", () => {
    expect(lockSql()).not.toMatch(/drop policy [^;]* on (public\.)?characters\b/)
  })

  it("drops the write policies those grants used to serve (020/032 on assets, 338 on the other three)", () => {
    const sql = lockSql()
    for (const name of [
      "users can insert assets with restrictions",
      "users can update own assets or admins can update library",
      "users can delete own assets or admins can delete library",
    ]) {
      expect(sql).toContain(`drop policy if exists "${name}" on public.assets;`)
    }
    for (const table of ["locations", "creatures", "objects"]) {
      for (const verb of ["insert", "update", "delete"]) {
        expect(sql).toContain(`drop policy if exists ${table}_${verb} on public.${table};`)
      }
    }
  })

  it("counts the rows already naming another user's object, before any lock is taken", () => {
    const sql = lockSql()
    expect(sql).toMatch(/raise notice 'assets rows naming another user''s object/)
    expect(sql).toMatch(/raise notice 'assets rows whose key another user''s row also names/)
    expect(sql).toMatch(/raise notice 'location, creature, object and character rows naming another user''s object/)
    expect(sql).toMatch(/union all select ch\.user_id, to_jsonb\(ch\)::text from public\.characters ch/)
    // The location count also sees a url another user's library row holds.
    expect(sql).toMatch(/join public\.assets o on o\.r2_url = m\.hit\[1\] where o\.user_id <> nb\.user_id/)
    expect(sql.indexOf("raise notice 'assets rows naming another user")).toBeLessThan(sql.indexOf("revoke insert"))
  })
})

/**
 * The SECURITY DEFINER functions that write these rows (review round, decided
 * 2026-10-07). Postgres grants EXECUTE to PUBLIC by default and PostgREST
 * exposes every `public` function, so a revoke on the table alone leaves them
 * open. Each `remove_*_asset` takes the row's owner as an argument (a browser
 * could edit any user's row), and `share_workflow_assets` shares any asset id
 * named in a workflow with no owner check.
 */
describe("the definer functions that edit those rows: the browser roles cannot execute them", () => {
  const BACKEND_ONLY = [
    "remove_location_asset(uuid, uuid, text, text)",
    "remove_creature_asset(uuid, uuid, text, text)",
    "remove_object_asset(uuid, uuid, text, text)",
  ] as const
  const esc = (fn: string) => fn.replace(/[()]/g, "\\$&")

  for (const fn of BACKEND_ONLY) {
    it(`${fn}: 480 revokes EXECUTE from PUBLIC, anon and authenticated; no later migration grants it back`, () => {
      expect(lockSql()).toMatch(
        new RegExp(`revoke execute on function public\\.${esc(fn)} from public, anon, authenticated;`),
      )
      const name = fn.slice(0, fn.indexOf("("))
      for (const file of laterMigrations()) {
        expect(sqlOf(file), `${file} grants ${name} back to a browser role`).not.toMatch(
          new RegExp(`grant [^;]*\\b(execute|all)\\b[^;]* on function [^;]*\\b${name}\\b[^;]* to [^;]*\\b(anon|authenticated|public)\\b`),
        )
        // CREATE OR REPLACE keeps the grants, but a DROP + CREATE starts over
        // with PUBLIC's default EXECUTE: a file that drops one must revoke again.
        const text = sqlOf(file)
        if (new RegExp(`drop function (if exists )?(public\\.)?${name}\\b`).test(text)) {
          expect(text, `${file} drops and recreates ${name} without revoking it again`).toMatch(
            new RegExp(`revoke execute on function (public\\.)?${name}\\([^)]*\\) from public, anon, authenticated;`),
          )
        }
      }
      for (const file of laterMigrations()) {
        expect(sqlOf(file), `${file} grants every function`).not.toMatch(
          /grant [^;]* on all functions in schema public to [^;]*\b(anon|authenticated|public)\b/,
        )
      }
    })
  }

  for (const fn of BACKEND_ONLY) {
    it(`${fn}: the backend's service role keeps EXECUTE`, () => {
      expect(lockSql()).toMatch(new RegExp(`grant execute on function public\\.${esc(fn)} to service_role;`))
    })
  }

  it("share_workflow_assets is dropped (decided 2026-10-07), and no later migration brings it back", () => {
    expect(lockSql()).toContain("drop function if exists public.share_workflow_assets(uuid);")
    expect(lockSql()).not.toMatch(/revoke [^;]* share_workflow_assets/)
    for (const file of laterMigrations()) {
      expect(sqlOf(file), `${file} recreates share_workflow_assets`).not.toMatch(
        /create (or replace )?function (public\.)?share_workflow_assets\b/,
      )
    }
  })

  it("the backend is the only caller of the remove_* functions, and nothing calls share_workflow_assets", () => {
    const callers = (name: string) =>
      sourceFiles(BACKEND_SRC)
        .filter((file) => new RegExp(`\\.rpc\\(\\s*["']${name}["']`).test(readFileSync(file, "utf8")))
        .map((file) => relative(REPO_ROOT, file))
    expect(callers("share_workflow_assets")).toEqual([])
    for (const fn of BACKEND_ONLY) {
      expect(callers(fn.slice(0, fn.indexOf("("))).length).toBeGreaterThan(0)
    }
  })
})

describe("a job, and a pipeline asset, points only at its own user's things", () => {
  const POINTERS = [
    {
      what: "jobs.pipeline_id",
      detach:
        /update public\.jobs j set pipeline_id = null from public\.pipelines p where p\.id = j\.pipeline_id and j\.user_id is distinct from p\.user_id;/,
      trigger:
        /create trigger trg_jobs_pointer_owner before insert or update of pipeline_id, parent_job_id, user_id on public\.jobs for each row execute function public\.jobs_pointer_owner_check\(\);/,
      fn: "jobs_pointer_owner_check",
      body: /p\.id = new\.pipeline_id and p\.user_id = new\.user_id/,
    },
    {
      what: "jobs.parent_job_id",
      detach:
        /update public\.jobs j set parent_job_id = null from public\.jobs parent where parent\.id = j\.parent_job_id and j\.user_id is distinct from parent\.user_id;/,
      trigger: /create trigger trg_jobs_pointer_owner /,
      fn: "jobs_pointer_owner_check",
      body: /parent\.id = new\.parent_job_id and parent\.user_id = new\.user_id/,
    },
    {
      what: "assets.pipeline_id",
      detach:
        /update public\.assets a set pipeline_id = null, pipeline_entity_id = null from public\.pipelines p where p\.id = a\.pipeline_id and a\.user_id is distinct from p\.user_id;/,
      trigger:
        /create trigger trg_assets_pipeline_owner before insert or update of pipeline_id, pipeline_entity_id, user_id on public\.assets for each row execute function public\.assets_pipeline_owner_check\(\);/,
      fn: "assets_pipeline_owner_check",
      body: /p\.id = new\.pipeline_id and p\.user_id = new\.user_id/,
    },
  ] as const

  for (const p of POINTERS) {
    it(`${p.what}: rows planted before the revoke are detached, then a trigger refuses a cross-user pointer`, () => {
      const sql = lockSql()
      expect(sql).toMatch(p.detach)
      expect(sql).toMatch(p.trigger)
      const def = latestDefinitionOf(p.fn)
      expect(def?.body).toMatch(p.body)
      expect(def?.body).toMatch(/raise exception/)
      // The clean-up runs first, or the table would hold rows the trigger forbids.
      const detachAt = sql.search(p.detach)
      expect(detachAt).toBeGreaterThan(-1)
      expect(detachAt).toBeLessThan(sql.search(p.trigger))
    })
  }

  it("no later migration drops a pointer-owner trigger", () => {
    for (const file of laterMigrations()) {
      expect(sqlOf(file), `${file} drops a pointer-owner trigger`).not.toMatch(
        /drop trigger (if exists )?(trg_jobs_pointer_owner|trg_assets_pipeline_owner|trg_pipeline_entities_asset_owner)\b/,
      )
    }
  })

  it("jobs.workflow_id gets no trigger: an app run's job names the creator's workflow by design", () => {
    // app-runner stamps the published app's workflow on the runner's job, and
    // a node route stamps the workflow its request names. Cross-user is
    // legitimate there, so the guard is on the read side (below), not here.
    expect(lockSql()).not.toMatch(/p\.id = new\.workflow_id|w\.id = new\.workflow_id/)
  })
})

/** Every non-test `.ts` file under backend/src. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue
      sourceFiles(path, out)
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      out.push(path)
    }
  }
  return out
}

/** Each `.from("<table>")` query: its text up to the next `.from(` (or 1500 chars). */
function tableQueries(table: string): Array<{ file: string; where: string; text: string }> {
  const queries: Array<{ file: string; where: string; text: string }> = []
  for (const file of sourceFiles(BACKEND_SRC)) {
    const src = readFileSync(file, "utf8")
    const re = new RegExp(`\\.from\\(\\s*["']${table}["']\\s*\\)`, "g")
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const rest = src.slice(m.index + m[0].length)
      const next = rest.search(/\.from\(/)
      const text = rest.slice(0, next === -1 ? 1500 : Math.min(next, 1500))
      const line = src.slice(0, m.index).split("\n").length
      const rel = relative(REPO_ROOT, file)
      queries.push({ file: rel, where: `${rel}:${line}`, text })
    }
  }
  return queries
}

/** A read (not an insert/update/upsert payload) filtered by one of `columns`. */
function readsThrough(text: string, columns: readonly string[]): boolean {
  if (/^\s*\.(insert|upsert|update)\(/.test(text)) return false
  return columns.some((c) => new RegExp(`\\.(eq|in)\\(\\s*["']${c}["']`).test(text))
}

describe("every read through a pointer asks for the owner's rows", () => {
  it("a jobs lookup by pipeline_id, parent_job_id or workflow_id also filters user_id", () => {
    const queries = tableQueries("jobs")
    expect(queries.length).toBeGreaterThan(50)
    const through = queries.filter((q) => readsThrough(q.text, ["pipeline_id", "parent_job_id", "workflow_id"]))
    expect(through.length).toBeGreaterThan(3)
    const unfiltered = through.filter((q) => !/\.eq\(\s*["']user_id["']/.test(q.text)).map((q) => q.where)
    expect(unfiltered).toEqual([])
  })

  it("an assets lookup by pipeline_id or pipeline_entity_id also filters user_id", () => {
    const through = tableQueries("assets").filter((q) => readsThrough(q.text, ["pipeline_id", "pipeline_entity_id"]))
    expect(through.length).toBeGreaterThan(0)
    const unfiltered = through.filter((q) => !/\.eq\(\s*["']user_id["']/.test(q.text)).map((q) => q.where)
    expect(unfiltered).toEqual([])
  })
})

/**
 * Files that delete storage objects whose keys the SERVER made in the same
 * flow, or under a prefix only the server writes — never a key read from a
 * row a user could have written. Everything else that deletes must import
 * `lib/key-ownership.ts`.
 *
 * "Deletes" covers both the `lib/storage.ts` deleters and a direct S3
 * `DeleteObject(s)Command` (review round, decided 2026-10-07): a file that
 * builds its own S3 delete is as much a deleter as one that calls ours.
 */
const SERVER_MADE_KEYS: Readonly<Record<string, string>> = {
  "backend/src/lib/storage.ts": "defines the deleters",
  "backend/src/lib/storage-delete.ts":
    "the delete funnel (decided 2026-10-08): deletes exactly the keys its callers pass and records what failed; every caller is in this census itself",
  "backend/src/lib/private-plugins/types.ts": "declares the plugin toolkit's deleter type; deletes nothing",
  "backend/src/ee/routes/admin.ts": "the app expunge deletes collectAppR2Keys' answer, which asks key-ownership itself",
  "backend/src/lib/job-policy-outputs.ts": "deletes only keys in the blocked job's own key family (isOwnedObjectKey)",
  "backend/src/lib/discard-job-copies.ts":
    "deletes only the copies the failed run itself just wrote, in its own job's key family (isOwnedObjectKey); never a key from a row",
  "backend/src/lib/workflow-delete.ts": "recast_audio_bases rows are service-role-only (334)",
  "backend/src/lib/private-plugins/toolkit.ts":
    "hands a plugin the relay-fenced deleter, NOT ownership-fenced. The cloud-plugins callers (checked 2026-10-07) delete keys they wrote themselves or read from their own server-written state: checkpoints, staged temp objects, recast fork copies and superseded takes. A host-side fence needs the calling job in the toolkit contract; open decision",
  "backend/src/lib/retained-images.ts":
    "deletes `retained-images/<id>`, the id from a service-role-only GC claim (claim_retained_image_gc, 396), never a key from a row",
  "backend/src/lib/retained-videos.ts":
    "deletes `retained-videos/<id>`, the id from a service-role-only GC claim (claim_retained_video_gc, 400), never a key from a row",
  "backend/src/services/scene3d-artifacts/object-store.ts":
    "the scene-3D artifact store's delete: its one caller (gc.ts) passes keys from service-role-only scene3d_artifact_gc rows (389) and skips any task naming another bucket",
  "backend/src/ee/services/community/asset-lifecycle.ts": "lists the server-owned community/<listingId>/ prefix",
  "backend/src/ee/services/community/clone.ts": "rolls back the copies it just made",
  "backend/src/routes/character-training.ts": "the training zip it uploaded in the same request",
  "backend/src/providers/video/edl-timeline.ts": "the render's own checkpoints",
  "backend/src/lib/speaker-frames-cache-sweep.ts":
    "lists the plugin-written speaker-frames-cache/ checkpoint prefix by age; no key comes from a row",
}

describe("every storage deleter asks whose object it is", () => {
  const deleters = sourceFiles(BACKEND_SRC)
    .map((file) => ({ file: relative(REPO_ROOT, file), src: readFileSync(file, "utf8") }))
    .filter(({ src }) =>
      /\b(batchDeleteFromR2|deleteFromR2|deleteKeysRecordingFailures|deleteKeyRecordingFailure)\s*\(|\bDeleteObjects?Command\b|\.delete\(\s*objectKey\b/.test(src),
    )

  it("finds the deleters (the census is not empty)", () => {
    expect(deleters.length).toBeGreaterThan(8)
  })

  it("a file that deletes keys found in rows imports lib/key-ownership.ts", () => {
    const blind = deleters
      .filter(({ file }) => !(file in SERVER_MADE_KEYS))
      .filter(({ src }) => !/from\s+["'][./]*(lib\/)?key-ownership\.js["']/.test(src))
      .map(({ file }) => file)
    expect(blind).toEqual([])
  })

  it("every listed exemption still deletes something (a stale entry would excuse a future deleter)", () => {
    expect(readFileSync(join(BACKEND_SRC, "lib", "collect-app-r2-keys.ts"), "utf8")).toMatch(
      /from\s+["']\.\/key-ownership\.js["']/,
    )
    for (const file of Object.keys(SERVER_MADE_KEYS)) {
      expect(deleters.some((d) => d.file === file), `${file} is listed but deletes nothing`).toBe(true)
    }
  })
})

/**
 * A pipeline entity's asset pointers (decisions round, decided 2026-10-07).
 * `main_asset_id` and `metadata.last_attempted_asset_id` name an asset by id;
 * the server reads them with the service role and turns them into reference
 * images, canvas pictures and the force-approved main image. Round 2 (decided
 * 2026-10-07) adds `last_frame_asset_id` (a branch copies it into new rows)
 * and `pipeline_entity_variants.asset_id` (keyframe identity references, the
 * entity card's variant images).
 */
describe("a pipeline entity's asset pointers name only its owner's assets", () => {
  it("rows written before 480 are counted, not changed", () => {
    const sql = lockSql()
    expect(sql).toMatch(/raise notice 'pipeline entities whose main_asset_id names another user''s asset/)
    expect(sql).toMatch(/raise notice 'pipeline entities whose last_attempted_asset_id names another user''s asset/)
    expect(sql).toMatch(/raise notice 'pipeline entities whose last_frame_asset_id names another user''s asset/)
    expect(sql).toMatch(/raise notice 'pipeline entity variants whose asset_id names another user''s asset/)
    expect(sql).toMatch(/raise notice 'scene entities whose scene_node_data names another user''s asset/)
    expect(sql).not.toMatch(/update (public\.)?pipeline_entities\b/)
    expect(sql).not.toMatch(/update (public\.)?pipeline_entity_variants\b/)
    expect(sql).not.toMatch(/delete from (public\.)?pipeline_entity_variants\b/)
  })

  it("a trigger refuses a cross-user main_asset_id or last_attempted_asset_id, for every writer", () => {
    expect(lockSql()).toMatch(
      /create trigger trg_pipeline_entities_asset_owner before insert or update of main_asset_id, last_frame_asset_id, metadata, pipeline_id on public\.pipeline_entities for each row execute function public\.pipeline_entities_asset_owner_check\(\);/,
    )
    const def = latestDefinitionOf("pipeline_entities_asset_owner_check")
    expect(def?.body).toMatch(/a\.id = new\.main_asset_id and a\.user_id = v_owner/)
    expect(def?.body).toMatch(/new\.metadata->>'last_attempted_asset_id'/)
    expect(def?.body).toMatch(/a\.id = v_attempt::uuid and a\.user_id = v_owner/)
    expect(def?.body).toMatch(/raise exception/)
  })

  it("the same trigger refuses a cross-user last_frame_asset_id, checking only a pointer that changed", () => {
    const def = latestDefinitionOf("pipeline_entities_asset_owner_check")
    expect(def?.body).toMatch(/new\.last_frame_asset_id is distinct from old\.last_frame_asset_id/)
    expect(def?.body).toMatch(/a\.id = new\.last_frame_asset_id and a\.user_id = v_owner/)
  })

  it("a trigger refuses a variant asset_id naming another user's asset, for every writer", () => {
    const sql = lockSql()
    expect(sql).toMatch(
      /create trigger trg_pipeline_entity_variants_asset_owner before insert or update of asset_id, entity_id on public\.pipeline_entity_variants for each row execute function public\.pipeline_entity_variants_asset_owner_check\(\);/,
    )
    expect(sql).toMatch(
      /revoke all on function public\.pipeline_entity_variants_asset_owner_check\(\) from public, anon, authenticated;/,
    )
    const def = latestDefinitionOf("pipeline_entity_variants_asset_owner_check")
    expect(def?.body).toMatch(/new\.entity_id is distinct from old\.entity_id/)
    expect(def?.body).toMatch(/new\.asset_id is distinct from old\.asset_id/)
    expect(def?.body).toMatch(/a\.id = new\.asset_id and a\.user_id = v_owner/)
    expect(def?.body).toMatch(/raise exception/)
  })

  it("the same trigger refuses a cross-user asset id anywhere in a scene's scene_node_data, judging only ids that changed", () => {
    // Round 3 (decided 2026-10-07): by key, not by list — any key named
    // `asset_id` or ending in `_asset_id`, at any depth, uuid-shaped values
    // only; an insert or a move judges every id, an update only the new ones.
    const def = latestDefinitionOf("pipeline_entities_asset_owner_check")
    expect(def?.body).toMatch(/v_scene jsonb := new\.metadata->'scene_node_data'/)
    expect(def?.body).toMatch(/v_old_scene jsonb := case when tg_op = 'update' then old\.metadata->'scene_node_data' end/)
    expect(def?.body).toContain(
      `'strict $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "(^|_)asset_id$" && @.value.type() == "string").value'`,
    )
    expect(def?.body).toMatch(/\bexcept\b/)
    expect(def?.body).toMatch(/case when v_moved then null else v_old_scene end/)
    expect(def?.body).toMatch(/left join public\.assets a on a\.id = changed\.id and a\.user_id = v_owner/)
    expect(def?.body).toMatch(/pipeline_entities\.metadata\.scene_node_data must name only assets of the pipeline''s owner/)
  })

  it("no later migration drops either entity pointer trigger", () => {
    for (const file of laterMigrations()) {
      const sql = sqlOf(file)
      expect(sql, file).not.toMatch(/drop trigger (if exists )?trg_pipeline_entities_asset_owner\b/)
      expect(sql, file).not.toMatch(/drop trigger (if exists )?trg_pipeline_entity_variants_asset_owner\b/)
    }
  })

  /**
   * Files that mention a pointer but only WRITE one the server just made, or
   * report whether it is set. Every other file must resolve it through
   * `lib/pipeline-asset-ownership.ts`.
   */
  const POINTER_WRITERS: Readonly<Record<string, string>> = {
    "backend/src/ee/pipelines/stages/objects.ts": "writes main_asset_id from the asset its own generation just made; reads none",
    "backend/src/ee/pipelines/stages/_image-critic-loop.ts": "writes last_attempted_asset_id from the critic loop's own attempt; reads none",
    "backend/src/ee/pipelines/entity-description.ts": "writes main_asset_id from the asset row it inserted for the caller; reads none",
    "backend/src/ee/pipelines/services/canvas-materializer.ts":
      "stores the mainAssetId entity-approval hands it, which that file already resolved to an owned asset",
    "backend/src/scripts/probe-stuck-pipeline.ts": "prints only whether main_asset_id is set",
    "backend/src/lib/pipeline-asset-ownership.ts": "is the owner-checked resolver itself",
    "backend/src/ee/pipelines/scene-internal-pipeline.ts":
      "writes last_frame_asset_id from the frame its own extract just made; reads none (its shot results are this run's values)",
    "backend/src/scripts/recover-stuck-variants.ts": "reads a variant's status only, never its asset_id",
  }
  const readers = sourceFiles(BACKEND_SRC)
    .map((file) => ({ file: relative(REPO_ROOT, file), src: readFileSync(file, "utf8") }))
    .filter(({ src }) =>
      /\b(main_asset_id|last_attempted_asset_id|last_frame_asset_id|pipeline_entity_variants)\b/.test(src),
    )

  it("finds the files (the census is not empty)", () => {
    expect(readers.length).toBeGreaterThan(6)
  })

  it("a file that reads one resolves it through lib/pipeline-asset-ownership.ts", () => {
    const blind = readers
      .filter(({ file }) => !(file in POINTER_WRITERS))
      .filter(({ src }) => !/from\s+["'][./]*(lib\/)?pipeline-asset-ownership\.js["']/.test(src))
      .map(({ file }) => file)
    expect(blind).toEqual([])
  })

  it("every listed writer still mentions a pointer (a stale entry would excuse a future reader)", () => {
    for (const file of Object.keys(POINTER_WRITERS)) {
      expect(readers.some((r) => r.file === file), `${file} is listed but mentions no pointer`).toBe(true)
    }
  })

  /**
   * A scene's asset ids in `scene_node_data` (round 3, decided 2026-10-07).
   * Every consumer found reads the sibling `*_url` field, never the id; the
   * files below name an id only to write one their own generation just made,
   * to drop one, or to label an audit row. A file that names one and is not
   * listed must resolve it through `lib/pipeline-asset-ownership.ts`.
   */
  const SCENE_POINTER_NON_RESOLVERS: Readonly<Record<string, string>> = {
    "backend/src/ee/pipelines/scene-internal-pipeline.ts":
      "writes the shot and composite ids its own generation just made and animates from the *_url fields; resolves none",
    "backend/src/ee/pipelines/shot-recovery.ts": "drops composite_video_asset_id when it clears a composite; resolves none",
    "backend/src/ee/pipelines/llms/helpers/audit-images.ts":
      "labels the image_critic_verdicts audit row with keyframe_asset_id; critiques keyframe_url",
    "backend/src/ee/pipelines/llms/helpers/fix-continuity.ts":
      "labels the audit row with keyframe_asset_id and returns the id of the keyframe it just made; critiques the urls",
    "backend/src/ee/pipelines/llms/helpers/validate-match-cut.ts":
      "labels the audit row with keyframe_asset_id; judges the urls",
  }
  /** Comments out: a scene pointer named in prose resolves nothing. */
  const codeOf = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
  const sceneReaders = sourceFiles(BACKEND_SRC)
    .map((file) => ({ file: relative(REPO_ROOT, file), src: codeOf(readFileSync(file, "utf8")) }))
    .filter(
      ({ src }) =>
        /\b(keyframe_asset_id|lipsynced_asset_id|composite_video_asset_id|scene_anchor_keyframe|generated_keyframes|generated_clips|scene_audio_track)\b/.test(src) ||
        (/\b(video_asset_id|audio_asset_id|last_frame_asset_id)\b/.test(src) &&
          /\b(scene_node_data|SceneNodeData|ShotSpec)\b/.test(src)),
    )

  it("finds the files that name a scene's asset ids (the census is not empty)", () => {
    expect(sceneReaders.length).toBeGreaterThan(5)
  })

  it("a file that names a scene's asset id resolves it through lib/pipeline-asset-ownership.ts, or is listed with why it resolves none", () => {
    const blind = sceneReaders
      .filter(({ file }) => !(file in SCENE_POINTER_NON_RESOLVERS))
      .filter(({ src }) => !/from\s+["'][./]*(lib\/)?pipeline-asset-ownership\.js["']/.test(src))
      .map(({ file }) => file)
    expect(blind).toEqual([])
  })

  it("every listed scene non-resolver still names a scene asset id (a stale entry would excuse a future reader)", () => {
    for (const file of Object.keys(SCENE_POINTER_NON_RESOLVERS)) {
      expect(sceneReaders.some((r) => r.file === file), `${file} is listed but names no scene asset id`).toBe(true)
    }
  })

  it("the branch copy drops a scene's foreign asset ids (and their urls) through the resolver", () => {
    const src = readFileSync(join(BACKEND_SRC, "ee", "pipelines", "branch-pipeline.ts"), "utf8")
    expect(src).toMatch(/sceneNodeDataAssetIds\(/)
    expect(src).toMatch(/withoutForeignSceneRefs\([^)]*ownedIds: owned/)
  })
})

/**
 * A scene's storage urls (decided 2026-10-07; migration 482). The urls beside
 * the ids in `scene_node_data` are what the server downloads and forwards; a
 * url on our storage another user made or holds is refused on write (482's
 * trigger, changed values only), counted where it already stands, and dropped
 * by every reader that downloads or forwards one.
 */
describe("a scene's storage urls name only the owner's objects", () => {
  const URL_MIGRATION = "482_scene_url_ownership.sql"
  const urlSql = () => sqlOf(URL_MIGRATION)

  it("rows written before 482 are counted, not changed", () => {
    expect(urlSql()).toMatch(/raise notice 'scene entities whose scene_node_data names another user''s storage url/)
    expect(urlSql()).not.toMatch(/update (public\.)?pipeline_entities\b/)
  })

  it("the trigger judges every url a write changes (an insert or a move: all of them), by key", () => {
    const def = latestDefinitionOf("pipeline_entities_asset_owner_check")
    expect(def?.file).toBe(URL_MIGRATION)
    expect(def?.body).toMatch(/select u\.url from public\.scene_node_data_urls\(v_scene\) as u\(url\) except select u\.url from public\.scene_node_data_urls\(case when v_moved then null else v_old_scene end\)/)
    expect(def?.body).toMatch(/public\.storage_url_is_foreign\(changed\.url, v_owner\)/)
    expect(def?.body).toMatch(/must name only storage urls of the pipeline''s owner/)
    // 480's checks are all still there.
    expect(def?.body).toMatch(/a\.id = new\.main_asset_id and a\.user_id = v_owner/)
    expect(def?.body).toMatch(/\(\^\|_\)asset_id\$/)
    expect(def?.body).toMatch(/the entity moved to another pipeline/)
    const urls = latestDefinitionOf("scene_node_data_urls")
    expect(urls?.body).toContain(`@.key like_regex "(^|_)urls?$"`)
  })

  it("the url judgment mirrors key-ownership.ts: job family, upload namespace, then another user's library row", () => {
    const def = latestDefinitionOf("storage_url_is_foreign")
    expect(def?.body).toMatch(/uploads\/\(\?:handoff\/\)\?/)
    expect(def?.body).toMatch(/from public\.jobs j where j\.id = left\(v_stem, 36\)::uuid/)
    expect(def?.body).toMatch(/a\.r2_key = any \(v_tails\)/)
    // Review round (decided 2026-10-07): the earliest claimant decides a
    // maker-less key, and a url's `url` parameters are judged with it.
    expect(def?.body).toMatch(/o\.user_id = p_owner and o\.created_at < a\.created_at/)
    expect(def?.body).toMatch(/public\.storage_url_query_urls\(p_url\)/)
  })

  for (const fn of [
    "scene_node_data_urls(jsonb)",
    "storage_url_path(text)",
    "storage_url_is_foreign(text, uuid)",
    "storage_url_normalize(text)",
    "storage_url_ascii_decode(text)",
    "storage_url_query_urls(text)",
  ]) {
    it(`${fn}: the browser roles cannot call it; the service role can`, () => {
      const name = fn.replace(/[()]/g, (c) => `\\${c}`)
      expect(urlSql()).toMatch(new RegExp(`revoke all on function public\\.${name} from public, anon, authenticated;`))
      expect(urlSql()).toMatch(new RegExp(`grant execute on function public\\.${name} to service_role;`))
      for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => versionOf(f) > versionOf(URL_MIGRATION))) {
        expect(sqlOf(file), file).not.toMatch(new RegExp(`grant execute on function public\\.${name} to (anon|authenticated|public)`))
      }
    })
  }

  /**
   * Files that name a scene url field but neither download nor forward a
   * stored one themselves. Every other file must read through the
   * owner-checked copy (`ownedSceneNodeData` / `withOwnedSceneRows` in
   * lib/pipeline-asset-ownership.ts).
   */
  const SCENE_URL_NON_FORWARDERS: Readonly<Record<string, string>> = {
    "backend/src/ee/pipelines/match-cut-orchestrator.ts":
      "receives its scene from Stage 6 (scene-images.ts), which hands it the owner-checked copy",
    "backend/src/ee/pipelines/llms/helpers/validate-match-cut.ts":
      "receives its scene from match-cut-orchestrator.ts or the helper route (scene-helpers.ts), both owner-checked",
    "backend/src/ee/pipelines/llms/helpers/audit-images.ts":
      "receives its scene from the helper route (scene-helpers.ts), which hands it the owner-checked copy",
    "backend/src/ee/pipelines/llms/helpers/fix-continuity.ts":
      "receives its scene from the helper route (scene-helpers.ts), which hands it the owner-checked copy",
    "backend/src/ee/pipelines/services/pipeline-animate-shot.ts":
      "receives its shot and start frame from scene-internal-pipeline.ts or the re-animate route, both owner-checked",
    "backend/src/ee/pipelines/shot-recovery.ts": "clears a scene's composite url; forwards none",
    "backend/src/ee/pipelines/stages/animate-audio-edit.ts":
      "reads the composite url scene-internal-pipeline.ts just returned (owner-checked) and video_critic flags; forwards none of the stored urls",
  }
  /** Comments out: a field named in prose forwards nothing. */
  const codeOf = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
  const urlReaders = sourceFiles(BACKEND_SRC)
    .map((file) => ({ file: relative(REPO_ROOT, file), src: codeOf(readFileSync(file, "utf8")) }))
    .filter(
      ({ src }) =>
        /\b(keyframe_url|video_url|last_frame_url|audio_url|lipsynced_url|bridged_frame_url|interpolation_keyframe_urls|composite_video_url)\b/.test(src) &&
        /\b(scene_node_data|SceneNodeData|ShotSpec)\b/.test(src),
    )
  const READS_OWNER_CHECKED = /\b(ownedSceneNodeData|withOwnedSceneRows)\(/

  it("finds the files that name a scene url (the census is not empty)", () => {
    expect(urlReaders.length).toBeGreaterThan(8)
  })

  it("a file that names a scene url reads the owner-checked copy, or is listed with why it forwards none", () => {
    const blind = urlReaders
      .filter(({ file }) => !(file in SCENE_URL_NON_FORWARDERS))
      .filter(({ src }) => !READS_OWNER_CHECKED.test(src))
      .map(({ file }) => file)
    expect(blind).toEqual([])
  })

  it("every listed non-forwarder still names a scene url (a stale entry would excuse a future reader)", () => {
    for (const file of Object.keys(SCENE_URL_NON_FORWARDERS)) {
      expect(urlReaders.some((r) => r.file === file), `${file} is listed but names no scene url`).toBe(true)
    }
  })

  it("the listed receivers are called only from owner-checked files", () => {
    // A receiver is safe only while its callers hand it the checked copy.
    const RECEIVERS: Record<string, string[]> = {
      "match-cut-orchestrator.js": ["backend/src/ee/pipelines/stages/scene-images.ts"],
      "llms/helpers/validate-match-cut.js": ["backend/src/ee/pipelines/match-cut-orchestrator.ts", "backend/src/routes/scene-helpers.ts"],
      "llms/helpers/audit-images.js": ["backend/src/routes/scene-helpers.ts"],
      "llms/helpers/fix-continuity.js": ["backend/src/routes/scene-helpers.ts"],
      "llms/editor.js": ["backend/src/ee/pipelines/sub-steps/_step-registry.ts"],
      "services/pipeline-animate-shot.js": [
        "backend/src/ee/pipelines/scene-internal-pipeline.ts",
        "backend/src/routes/pipelines.ts",
      ],
    }
    const all = sourceFiles(BACKEND_SRC).map((file) => ({ file: relative(REPO_ROOT, file), src: readFileSync(file, "utf8") }))
    for (const [module, allowed] of Object.entries(RECEIVERS)) {
      const callers = all
        .filter(({ src }) => new RegExp(`["'][./]*(ee/pipelines/)?${module.replace(/[./]/g, (c) => `\\${c}`)}["']`).test(src))
        .map(({ file }) => file)
        .filter((file) => !file.endsWith(module.replace(/\.js$/, ".ts")))
      expect(callers.sort(), module).toEqual([...allowed].sort())
    }
  })

  it("the helper route and the re-animate route hand on the owner-checked copy", () => {
    const helpers = readFileSync(join(BACKEND_SRC, "routes", "scene-helpers.ts"), "utf8")
    expect(helpers).toMatch(/ownedSceneNodeData\(supabase, userId, sceneNodeData\)/)
    const routes = readFileSync(join(BACKEND_SRC, "routes", "pipelines.ts"), "utf8")
    expect(routes).toMatch(/ownedSceneNodeData\(supabase, userId, snd\)/)
  })
})
