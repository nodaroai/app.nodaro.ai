/**
 * Is a stored Video Overlay result still what the current settings would
 * render? The key itself — `videoOverlayCompositionKey` over the base, every
 * slot's image (`videoOverlaySlotSources`) and the settings — lives in
 * @nodaro/shared: the canvas single-node Run (which also sends it with the
 * request, so the REST job echoes it back after a reload) and the backend DAG
 * payload both stamp it on the result (`resultCompositionKey`), so a result
 * from any run of the current settings reads fresh.
 *
 * Only a result stamped with the current key is fresh. There is deliberately
 * NO output-size fallback (Image Overlay's `overlayResultMatches` has one): on
 * this node the output size IS the base size, so a size check would call every
 * unstamped result fresh. An unstamped result (a run from before the stamp, or
 * a REST call that sent no key) therefore reads as "Result (old)" — the live
 * preview shows, the result is one click away.
 */
export function videoOverlayResultFresh(currentKey: string, result: { resultCompositionKey?: unknown } | undefined): boolean {
  return typeof result?.resultCompositionKey === "string" && result.resultCompositionKey === currentKey
}
