/**
 * The content rights declaration a person confirms before a link is imported,
 * as this page holds it (`nodaroClient.contentRights`): read once and shared
 * by every Video URL node and app card on the page, and ONE confirmation per
 * download — a confirmation opens one download of its link, so a video and
 * its sound, or a download and its restart, each record their own, all under
 * the box the person ticked for that link.
 *
 * The box itself is never stored: ticked is a state of this session, kept
 * beside the download it allows (`video-link-ingest.ts`, the app card), so a
 * workflow saved ticked never lets the next person's Run confirm for them.
 */
import { useEffect, useSyncExternalStore } from "react"
import type { ContentRightsConfirmation, ContentRightsDeclaration } from "@nodaro/sdk/content-rights"
import { nodaroClient } from "@/lib/nodaro-client"
import { declarationChanged } from "@/lib/declaration-changes"

export type RightsDeclarationState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly declaration: ContentRightsDeclaration }
  | { readonly status: "failed" }

/** The declaration changed on the server since it was read: the person must see the new text and tick again. */
export class DeclarationChangedError extends Error {
  constructor() {
    super("The declaration changed; read the current text and confirm again.")
    this.name = "DeclarationChangedError"
  }
}

const LOADING: RightsDeclarationState = { status: "loading" }

let state: RightsDeclarationState = LOADING
let asked = false
let inflight: Promise<ContentRightsDeclaration> | null = null
/** The version last read: a read that finds another one means every box was ticked under replaced text. */
let heldVersion: number | null = null
const listeners = new Set<() => void>()

function publish(next: RightsDeclarationState): void {
  state = next
  for (const listener of listeners) listener()
}

/** The current declaration: the one read already, else read now — one request, shared by every caller. */
export function loadDeclaration(): Promise<ContentRightsDeclaration> {
  if (state.status === "ready") return Promise.resolve(state.declaration)
  if (inflight) return inflight
  asked = true
  publish(LOADING)
  const request = nodaroClient.contentRights.declaration().then(
    (declaration) => {
      if (inflight === request) {
        inflight = null
        const replaced = heldVersion !== null && heldVersion !== declaration.version
        heldVersion = declaration.version
        publish({ status: "ready", declaration })
        // Whoever read it again (a stale confirmation, the Settings card's stale
        // answer), every box on the page was ticked under the text it replaces.
        if (replaced) declarationChanged()
      }
      return declaration
    },
    (err: unknown) => {
      if (inflight === request) {
        inflight = null
        publish({ status: "failed" })
      }
      throw err
    },
  )
  inflight = request
  return request
}

/** Forget what was read and read again (after a failed read, or a changed declaration). */
export function reloadDeclaration(): void {
  inflight = null
  state = LOADING
  loadDeclaration().catch(() => undefined)
}

function isStale(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "rights_confirmation_stale"
}

/**
 * Records that the person confirmed the declaration, as read, for `url`, and
 * answers the confirmation (its `id` is what a download carries; `expiresAt`
 * is when it stops opening one). Called once per download, by the download. A
 * changed declaration is read again, every box on the page is unticked
 * (`declaration-changes.ts`: each was ticked under the old text), and it is
 * thrown as `DeclarationChangedError`.
 */
export async function confirmLink(url: string): Promise<ContentRightsConfirmation> {
  const declaration = await loadDeclaration()
  try {
    return await nodaroClient.contentRights.confirm({ url, declarationVersion: declaration.version })
  } catch (err) {
    if (!isStale(err)) throw err
    reloadDeclaration()
    declarationChanged()
    throw new DeclarationChangedError()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const snapshot = (): RightsDeclarationState => state

/** The declaration for a box to show: read on first use, shared by every box on the page. */
export function useRightsDeclaration(): RightsDeclarationState {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    if (!asked) loadDeclaration().catch(() => undefined)
  }, [])
  return current
}

export function __resetContentRightsForTests(): void {
  state = LOADING
  asked = false
  inflight = null
  heldVersion = null
  listeners.clear()
}
