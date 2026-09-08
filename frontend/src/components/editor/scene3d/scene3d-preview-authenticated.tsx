"use client"

import { useMemo } from "react"
import { Scene3DPreview, type Scene3DPreviewProps } from "./scene3d-preview"
import { createAuthenticatedScene3DAssetResolver } from "@/lib/scene3d/authenticated-asset-resolver"
import { validateScene3DAnyPlan } from "@/lib/scene3d/validate-plan"

/**
 * `Scene3DPreview` with the editor's own asset access wired in.
 *
 * This exists as a separate MODULE, not as a default inside the panel, because
 * `/embed/scene3d` renders `Scene3DPreview` and must never load auth. A runtime
 * branch ("build a session-backed resolver only if none was passed") would make
 * that guarantee depend on a condition; a separate module makes it a property
 * of the import graph, which a test can actually assert
 * (`lib/scene3d/__tests__/embed-auth-isolation.test.ts`).
 *
 * So: the editor imports THIS, the embed imports the panel. Same props, same
 * component, one extra prop supplied.
 */
export function Scene3DPreviewAuthenticated(props: Scene3DPreviewProps) {
  const validation = useMemo(() => validateScene3DAnyPlan(props.scenePlan), [props.scenePlan])
  const revisionId = validation.ok && validation.version === 2 ? validation.plan.revisionId : null

  /**
   * One resolver per revision, created SYNCHRONOUSLY.
   *
   * The canvas asks for assets on its first commit; a resolver that arrived a
   * tick later would make that first attempt fail with "no asset resolver" and
   * only then reload. Nothing here needs to be async — `nodaroClient` sources
   * its token inside each request, so building the resolver costs nothing and
   * the auth still happens per call, on the live session.
   */
  const assetResolver = useMemo(
    () => (revisionId ? createAuthenticatedScene3DAssetResolver(revisionId) : undefined),
    [revisionId],
  )

  return <Scene3DPreview {...props} assetResolver={props.assetResolver ?? assetResolver} />
}
