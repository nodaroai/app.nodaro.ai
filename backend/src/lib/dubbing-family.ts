import type { DubbingLanguageStatus } from "@nodaro/shared/media"
import { isDubbingProject, parseProjectTaskId } from "../providers/elevenlabs/dubbing-project-id.js"
import {
  readProjectDub,
  readRegularDub,
  type DubbingRead,
  type ProjectDub,
  type ProjectLanguage,
} from "../providers/elevenlabs/dubbing-read.js"
import type { DubFamily, DubJobRow } from "./dubbing-job-store.js"
import { canonicalLanguage } from "./dubbing-language.js"
import { DUBBING_PROBLEMS, dubbingAnswer, dubbingRefusal, type DubbingOutcome, type DubbingProblem } from "./dubbing-problems.js"

/**
 * Who is in a dub's family, and in what state.
 *
 * A dub is one job, plus one job per language added to it later
 * (lib/dubbing-job-store.ts lists them). This module asks the dubbing service
 * what it holds for those jobs and answers one list of languages: each with
 * the job that delivers it, its state, and where its lines are read from.
 *
 * Two engines make dubs. A project dub holds all its languages in one
 * project, so a language can also be there with no job of ours delivering it
 * (its job was trashed, or it was never delivered): it is listed with no job,
 * and adding the language again delivers it, unless its lines changed after
 * its media was made (`stale`). A regular dub holds one language; each added
 * language is a dub of its own.
 *
 * The checks of the first job live here too, so the reads and the
 * add-language call refuse a dub in exactly the same cases.
 */

export type DubEngine = "project" | "regular"

/** Which engine holds a dub, by the id its job kept. null when the job kept none. */
export function dubEngineOf(job: Pick<DubJobRow, "providerTaskId">): DubEngine | null {
  const id = job.providerTaskId
  if (id === null || id === "") return null
  return isDubbingProject(id) ? "project" : "regular"
}

/** Where a language is held at the dubbing service. Never sent to a caller. */
export type LanguageRef =
  | { readonly kind: "project"; readonly taskId: string; readonly languageId: string }
  | { readonly kind: "regular"; readonly dubbingId: string; readonly code: string }

export interface FamilyLanguage {
  /** The code the language was asked for; the service's own code when no job asked. */
  readonly code: string
  /** The job that delivers the language; null when the service holds it and no job does. */
  readonly jobId: string | null
  readonly status: DubbingLanguageStatus
  /** null when it is not known where the language is held. Lines are there only once it is `completed` or `stale`. */
  readonly ref: LanguageRef | null
}

export interface ResolvedDubFamily {
  readonly familyId: string
  /** The job the family is read through: the first job, or the one asked for when the first is gone. */
  readonly anchor: DubJobRow
  readonly engine: DubEngine
  readonly durationSec: number | null
  readonly sourceLanguage: string | null
  /** One per language: the first job's, then the added ones oldest first, then those no job delivers. */
  readonly languages: readonly FamilyLanguage[]
}

/** The dubbing service could not be asked: it is down, or answered something no read expects. */
export class DubbingServiceError extends Error {
  readonly reason: unknown

  constructor(reason: unknown) {
    super("The dubbing service could not be read")
    this.name = "DubbingServiceError"
    this.reason = reason
  }
}

/** Runs one read of the dubbing service, so its failure is told apart from a failure of ours. */
export async function askService<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (reason) {
    throw new DubbingServiceError(reason)
  }
}

type JobState = "completed" | "failed" | "processing"

function jobStateOf(job: DubJobRow): JobState {
  if (job.status === "completed") return "completed"
  return job.status === "failed" || job.status === "cancelled" ? "failed" : "processing"
}

function askedLanguage(job: DubJobRow): string {
  const asked = job.input.targetLanguage
  return typeof asked === "string" ? asked.trim() : ""
}

/** A language of the list before one is chosen per code. */
interface Candidate extends FamilyLanguage {
  /** When its job was made; empty for a language no job delivers. */
  readonly createdAt: string
}

type ProjectReader = (taskId: string) => Promise<DubbingRead<ProjectDub>>

/** Each project is read once per request, however many jobs live in it. */
function projectReader(): ProjectReader {
  const reads = new Map<string, Promise<DubbingRead<ProjectDub>>>()
  return (taskId) => {
    const { projectId } = parseProjectTaskId(taskId)
    const known = reads.get(projectId)
    if (known) return known
    const read = askService(() => readProjectDub(taskId))
    reads.set(projectId, read)
    return read
  }
}

/** The language a project job delivers: the one its id names, else the project's first. */
function languageOfTask(project: ProjectDub, taskId: string): ProjectLanguage | undefined {
  const { languageId } = parseProjectTaskId(taskId)
  return languageId ? project.languages.find((language) => language.id === languageId) : project.languages[0]
}

async function jobCandidate(job: DubJobRow, projectOf: ProjectReader): Promise<Candidate | null> {
  const asked = askedLanguage(job)
  const state = jobStateOf(job)
  const own = { jobId: job.id, createdAt: job.createdAt }
  const unread = (status: DubbingLanguageStatus): Candidate | null => (asked === "" ? null : { ...own, code: asked, status, ref: null })
  if (state !== "completed") return unread(state)

  const taskId = job.providerTaskId
  const engine = dubEngineOf(job)
  if (engine === null || taskId === null) return unread("completed")
  if (engine === "regular") {
    return asked === "" ? null : { ...own, code: asked, status: "completed", ref: { kind: "regular", dubbingId: taskId, code: asked } }
  }

  const read = await projectOf(taskId)
  const language = read.kind === "ok" ? languageOfTask(read.value, taskId) : undefined
  if (!language) return unread("completed")
  return {
    ...own,
    code: asked === "" ? language.code : asked,
    status: language.status === "stale" ? "stale" : "completed",
    ref: { kind: "project", taskId, languageId: language.id },
  }
}

async function jobCandidates(jobs: readonly DubJobRow[], projectOf: ProjectReader): Promise<Candidate[]> {
  const found = await Promise.all(jobs.map((job) => jobCandidate(job, projectOf)))
  return found.flatMap((candidate) => candidate ?? [])
}

/**
 * The language of `project` a job delivers or is about to: by the id it kept,
 * or, for a job that has not reached the service yet, by the language it was
 * made to deliver. A failed job delivers none, so its language is free to be
 * delivered again.
 */
function deliveredLanguageId(job: DubJobRow, project: ProjectDub, projectId: string): string | null {
  if (jobStateOf(job) === "failed") return null
  const taskId = job.providerTaskId
  if (taskId !== null && taskId !== "") {
    if (!isDubbingProject(taskId)) return null
    const parsed = parseProjectTaskId(taskId)
    if (parsed.projectId !== projectId) return null
    return parsed.languageId || project.languages[0]?.id || null
  }
  const adopted = job.input.adoptLanguageId
  const into = job.input.projectTaskId
  if (typeof adopted !== "string" || adopted === "" || typeof into !== "string" || !isDubbingProject(into)) return null
  return parseProjectTaskId(into).projectId === projectId ? adopted : null
}

function heldStatus(status: string): DubbingLanguageStatus {
  return status === "completed" || status === "stale" || status === "failed" ? status : "processing"
}

/** The languages the project holds that no job of the family delivers. */
function undeliveredLanguages(project: ProjectDub, taskId: string, jobs: readonly DubJobRow[]): Candidate[] {
  const { projectId } = parseProjectTaskId(taskId)
  const delivered = new Set(jobs.flatMap((job) => deliveredLanguageId(job, project, projectId) ?? []))
  return project.languages
    .filter((language) => !delivered.has(language.id))
    .map((language) => ({
      code: language.code,
      jobId: null,
      status: heldStatus(language.status),
      ref: { kind: "project", taskId, languageId: language.id },
      createdAt: "",
    }))
}

const RANK: Readonly<Record<DubbingLanguageStatus, number>> = { completed: 0, stale: 1, processing: 2, failed: 3 }

const madeAt = (candidate: Candidate): number => {
  const at = Date.parse(candidate.createdAt)
  return Number.isNaN(at) ? 0 : at
}

/** The better telling of one language: the furthest along, then one a job delivers, then the newest job. */
function beats(one: Candidate, other: Candidate): boolean {
  if (RANK[one.status] !== RANK[other.status]) return RANK[one.status] < RANK[other.status]
  if ((one.jobId === null) !== (other.jobId === null)) return one.jobId !== null
  return madeAt(one) > madeAt(other)
}

/** One entry per language, at the place the language was first seen. */
function onePerLanguage(candidates: readonly Candidate[]): FamilyLanguage[] {
  const best = new Map<string, Candidate>()
  for (const candidate of candidates) {
    const key = canonicalLanguage(candidate.code)
    const current = best.get(key)
    if (!current || beats(candidate, current)) best.set(key, candidate)
  }
  return [...best.values()].map(({ code, jobId, status, ref }) => ({ code, jobId, status, ref }))
}

/** A dub is read and added to only once it is made. */
function anchorProblem(anchor: DubJobRow): DubbingProblem | null {
  const state = jobStateOf(anchor)
  if (state === "failed") return DUBBING_PROBLEMS.failed
  return state === "processing" ? DUBBING_PROBLEMS.notReady : null
}

function refuseAnchorRead(read: Exclude<DubbingRead<unknown>, { readonly kind: "ok" }>): DubbingOutcome<never> {
  if (read.kind === "gone") return dubbingRefusal(DUBBING_PROBLEMS.unavailable)
  if (read.kind === "processing") return dubbingRefusal(DUBBING_PROBLEMS.notReady)
  return dubbingRefusal(DUBBING_PROBLEMS.readFailed, `the dubbing service refused to tell the dub (${read.code})`)
}

/**
 * The family as the dubbing service holds it now, or the refusal a dub that
 * cannot be read is answered with. Throws `DubbingServiceError` when the
 * service cannot be asked.
 */
export async function resolveDubFamily(family: DubFamily): Promise<DubbingOutcome<ResolvedDubFamily>> {
  const { anchor, familyId } = family
  const problem = anchorProblem(anchor)
  if (problem) return dubbingRefusal(problem)
  const engine = dubEngineOf(anchor)
  const taskId = anchor.providerTaskId
  if (engine === null || taskId === null) return dubbingRefusal(DUBBING_PROBLEMS.unavailable)

  const projectOf = projectReader()
  const jobs = [anchor, ...family.members]
  if (engine === "regular") {
    const read = await askService(() => readRegularDub(taskId))
    if (read.kind !== "ok") return refuseAnchorRead(read)
    const { durationSec, sourceLanguage } = read.value
    const languages = onePerLanguage(await jobCandidates(jobs, projectOf))
    return dubbingAnswer({ familyId, anchor, engine, durationSec, sourceLanguage, languages })
  }

  const read = await projectOf(taskId)
  if (read.kind !== "ok") return refuseAnchorRead(read)
  const project = read.value
  const delivered = await jobCandidates(jobs, projectOf)
  const languages = onePerLanguage([...delivered, ...undeliveredLanguages(project, taskId, jobs)])
  return dubbingAnswer({ familyId, anchor, engine, durationSec: project.durationSec, sourceLanguage: project.sourceLanguage, languages })
}
