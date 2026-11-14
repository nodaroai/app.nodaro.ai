import { supabase } from "./supabase.js"
import { CHILD_JOB_COLUMN, TRASHED_JOB_COLUMN } from "./public-job-data.js"
import { RESTRICTED_JOB_COLUMN } from "./content-restrictions-column.js"

/**
 * The jobs of one dub, as their owner may read them.
 *
 * A dub is one job. A language added to it later is another job that names
 * the first one (`input_data.sourceDubJobId`), so "the dub" is a family: the
 * job it began with and the languages added since. Any job of the family
 * opens the whole family.
 *
 * Every read here is the owner's own live work: someone else's job, a hidden
 * step of another job, a job in the Trash and a restricted job all read as
 * missing, so a caller cannot tell them apart from a job that never existed.
 * A dub with a restricted job is closed as a whole.
 */

/** `input_data.type` of a dub. `job_type` is empty until a worker picks the job up. */
export const DUBBING_JOB_TYPE = "dubbing"

/** The key an added language's job names its family by. Stamped by the server only. */
export const SOURCE_DUB_JOB_KEY = "sourceDubJobId"

/**
 * Where a job names its family, as a query reads it. Asked with `ilike`, never
 * an exact match: a job id means the same in capitals, and the family id is
 * told in lower case, so a name is matched whatever its case. A job id holds
 * no pattern character, so what is matched is the whole name.
 */
const NAMED_FAMILY = `input_data->>${SOURCE_DUB_JOB_KEY}`

const COLUMNS = "id, status, provider_task_id, input_data, created_at"

/** A dub is offered in a few dozen languages; this is far past any real family. */
const MEMBER_LIMIT = 200

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface DubJobRow {
  readonly id: string
  readonly status: string
  readonly providerTaskId: string | null
  readonly input: Readonly<Record<string, unknown>>
  readonly createdAt: string
}

export interface DubFamily {
  /** The id every job of the family shares: the job the dub began with. */
  readonly familyId: string
  /** The job the dub is read through: the first job while it is live, else the one asked for. */
  readonly anchor: DubJobRow
  /** The other live jobs of the family, oldest first. */
  readonly members: readonly DubJobRow[]
}

export type DubFamilyLoad =
  | { readonly kind: "ok"; readonly family: DubFamily }
  | { readonly kind: "not_found" }
  | { readonly kind: "not_a_dubbing_job" }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const filled = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null)

function rowOf(raw: unknown): DubJobRow | null {
  if (!isRecord(raw)) return null
  const id = filled(raw.id)
  if (!id) return null
  return {
    id,
    status: filled(raw.status) ?? "",
    providerTaskId: filled(raw.provider_task_id),
    input: isRecord(raw.input_data) ? raw.input_data : {},
    createdAt: filled(raw.created_at) ?? "",
  }
}

const isDub = (job: DubJobRow): boolean => job.input.type === DUBBING_JOB_TYPE

/** The family a dub job belongs to: the one it names, else its own. Told the way a job's id is written, in lower case. */
export function dubFamilyIdOf(job: DubJobRow): string {
  const named = job.input[SOURCE_DUB_JOB_KEY]
  return typeof named === "string" && UUID.test(named) ? named.toLowerCase() : job.id
}

async function loadOwnJob(ownerId: string, jobId: string): Promise<DubJobRow | null> {
  const { data, error } = await supabase
    .from("jobs")
    .select(COLUMNS)
    .eq("id", jobId)
    .eq("user_id", ownerId)
    .is(CHILD_JOB_COLUMN, null)
    .is(TRASHED_JOB_COLUMN, null)
    .is(RESTRICTED_JOB_COLUMN, null)
    .maybeSingle()
  if (error) throw error
  return rowOf(data)
}

/** The owner's live jobs that name `familyId`, oldest first. */
async function loadMembers(ownerId: string, familyId: string, since: string | null): Promise<readonly DubJobRow[]> {
  const named = supabase
    .from("jobs")
    .select(COLUMNS)
    .eq("user_id", ownerId)
    .ilike(NAMED_FAMILY, familyId)
    .is(CHILD_JOB_COLUMN, null)
    .is(TRASHED_JOB_COLUMN, null)
    .is(RESTRICTED_JOB_COLUMN, null)
  // A language is added after the dub it is added to, so nothing older can belong.
  const bounded = since ? named.gte("created_at", since) : named
  const { data, error } = await bounded.order("created_at", { ascending: false }).limit(MEMBER_LIMIT)
  if (error) throw error
  const rows: readonly unknown[] = Array.isArray(data) ? data : []
  return rows.flatMap((raw) => rowOf(raw) ?? []).reverse()
}

/**
 * Whether a job of the family is restricted. One restricted job closes the
 * whole dub: its lines are read from the dubbing service, not from the job's
 * stored output, so nothing else would keep them out of reach. Asked of every
 * job of the family, hidden steps and the Trash included: a restricted job
 * stays restricted wherever it is filed.
 */
async function hasRestrictedJob(ownerId: string, familyId: string): Promise<boolean> {
  // trash-read: a restricted job closes its dub from the Trash too.
  const restricted = () => supabase.from("jobs").select("id").eq("user_id", ownerId).not(RESTRICTED_JOB_COLUMN, "is", null)
  const answers = await Promise.all([
    restricted().eq("id", familyId).limit(1),
    restricted().ilike(NAMED_FAMILY, familyId).limit(1),
  ])
  const failed = answers.find((answer) => answer.error)
  if (failed) throw failed.error
  return answers.some(({ data }) => Array.isArray(data) && data.length > 0)
}

/**
 * The family `jobId` belongs to, for its owner. `not_found` covers a job that
 * does not exist, is someone else's, is a hidden step, is in the Trash, is
 * restricted or belongs to a dub with a restricted job, or is not a job id at
 * all.
 */
export async function loadDubFamily(ownerId: string, jobId: string): Promise<DubFamilyLoad> {
  if (!UUID.test(jobId)) return { kind: "not_found" }
  const requested = await loadOwnJob(ownerId, jobId)
  if (!requested) return { kind: "not_found" }
  if (!isDub(requested)) return { kind: "not_a_dubbing_job" }

  const familyId = dubFamilyIdOf(requested)
  if (await hasRestrictedJob(ownerId, familyId)) return { kind: "not_found" }
  const first = familyId === requested.id ? requested : await loadOwnJob(ownerId, familyId)
  const anchor = first && isDub(first) ? first : requested
  const named = await loadMembers(ownerId, familyId, anchor.id === familyId ? filled(anchor.createdAt) : null)
  const members = named.filter((job) => job.id !== anchor.id && isDub(job))
  return { kind: "ok", family: { familyId, anchor, members } }
}
