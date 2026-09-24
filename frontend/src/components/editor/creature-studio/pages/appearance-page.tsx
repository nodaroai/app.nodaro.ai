import { useContext, useState } from "react"
import { ANIMALS } from "@nodaro/shared"
import { optimizedImageUrl } from "@/lib/image"
import { useT } from "@/lib/i18n"
import type { StudioPageProps } from "../../studio-shell/types"
import type { CreatureStudioJobs } from "../use-creature-studio-jobs"
import type { CreatureStudioState } from "../use-creature-studio"
import { CreatureCandidatesContext } from "../creature-candidates-context"

/**
 * Appearance page — main image preview, identity form (name + species +
 * description), Generate button with candidate count (1/2/4), candidates grid
 * with Approve/Discard per card, and the canonical description display. Split
 * out of the old `appearance-tab.tsx`; the reference-photo mood-board now lives
 * on the References page (Resources group). Behavior is otherwise byte-identical,
 * including the creature-specific deltas:
 *  - A free-text Species / Type field with `<datalist>` autocomplete from the
 *    @nodaro/shared ANIMALS catalog (mirrors CreatureConfig). Accepts arbitrary
 *    text (e.g. "griffin", "dragon").
 *  - NO UpstreamPickerBanner — CreatureNodeData has no `legacyPickerSelection`
 *    breadcrumb (that was an object E1-migration artifact with no creature
 *    equivalent).
 *  - generateCreature returns `{ jobId } | { jobIds: string[] }` — the
 *    `"jobIds" in result` type guard feeds both shapes into trackJob.
 *
 * Approval flow:
 *  1. User clicks Generate → ensureSavedBeforeGen() creates the row if needed.
 *  2. POST /v1/generate-creature with `count` and (count===1) attachToCreatureId.
 *  3. useCreatureStudioJobs (modal-scoped, in useCreatureCandidates) polls; on
 *     completion pushes into the candidate grid.
 *  4. User clicks Approve → POST /v1/creatures/:id/approve-main-image with the
 *     candidateJobId. The route persists source_image_url + canonical_description.
 *  5. setIsApprovingMainImage(true) during the in-flight call so Generate is
 *     locked out — prevents an "approve then immediately re-generate" race.
 *
 * The main-image candidate state + its candidate-generation jobs tracker now
 * live at MODAL scope (`useCreatureCandidates`, provided via
 * `CreatureCandidatesContext`) so in-flight candidates + the completed-candidate
 * grid survive Appearance↔other-tab navigation (StudioShell unmounts this page
 * on every switch). This page is a pure consumer of that API — it does NOT own
 * the candidates array or the jobs hook, and does NOT consume the shell-supplied
 * `jobs`. Mirrors character's Profile page reading `PortraitCandidatesContext`.
 */

// Datalist suggestions for the free-text species field — the animal catalog
// (cats/dogs/wild/birds/sea/mythical/etc.). The field accepts ANY free text
// (e.g. "griffin", "red fox"); these are just autocomplete hints. Ids are
// stable so they're safe as React keys. Mirrors CreatureConfig.
const ANIMAL_SPECIES_SUGGESTIONS = ANIMALS

export function AppearancePage({ state }: StudioPageProps<CreatureStudioState, CreatureStudioJobs>) {
  const t = useT()
  const studio = state
  const data = studio.stagedData
  const [count, setCount] = useState<1 | 2 | 4>(1)
  // Candidate state + jobs tracker live at MODAL scope; this page only consumes
  // the API (see CreatureCandidatesContext). The null-guard throw matches
  // character's ProfilePage — AppearancePage always renders inside the provider.
  const cands = useContext(CreatureCandidatesContext)
  if (!cands) {
    throw new Error("AppearancePage must render within a CreatureCandidatesContext provider")
  }

  // Guard against the cold-load case — the modal already short-circuits to
  // a placeholder, so by the time AppearancePage mounts `data` is non-null.
  if (!data) return null

  // Lock approval flow whenever a main-image generation job is in flight.
  // Prevents the "approve candidate A while candidate B is still generating"
  // race even within a single tab. Discard is gated by the same condition.
  const mainImageGenPending = cands.tracked.some((j) => j.assetType === "main")
  const approveDiscardDisabled = studio.isApprovingMainImage || mainImageGenPending

  const generateDisabled =
    studio.isApprovingMainImage || studio.isSaving || !data.creatureName.trim()

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="space-y-6 max-w-2xl mx-auto">
        {/* Main image preview */}
        <section>
          <h2 className="text-[12px] font-medium text-slate-300 mb-2">{t("creature.mainImage")}</h2>
          {data.sourceImageUrl ? (
            <img
              src={optimizedImageUrl(data.sourceImageUrl, { width: 800 })}
              alt={data.creatureName || t("assetlib.typeCreature")}
              loading="lazy"
              className="w-full max-h-[400px] object-contain rounded border border-[#1e293b]"
            />
          ) : (
            <div className="aspect-video bg-[#1a1d27] rounded border border-[#1e293b] flex items-center justify-center text-[11px] text-slate-500">
              {t("creature.noMainImageYet")}
            </div>
          )}
        </section>

        {/* Identity form */}
        <section className="space-y-3">
          <h2 className="text-[12px] font-medium text-slate-300">{t("creature.identity")}</h2>
          <label className="block">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">{t("common.name")}</span>
            <input
              type="text"
              value={data.creatureName || ""}
              onChange={(e) => studio.patch({ creatureName: e.target.value })}
              placeholder={t("creature.namePlaceholder")}
              className="w-full mt-1 px-3 py-2 text-[12px] bg-[#1a1d27] border border-[#1e293b] rounded text-slate-200 placeholder:text-slate-600"
            />
          </label>
          {/* Species / Type — free-text with autocomplete from the animal
              catalog. Accepts arbitrary text (e.g. "griffin") so mythical /
              hybrid creatures aren't locked to the catalog. Distinct from the
              object's hard category enum. Mirrors CreatureConfig. */}
          <label className="block">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">{t("cfgext.entSpeciesType")}</span>
            <input
              type="text"
              list="creature-studio-species-suggestions"
              value={data.species ?? ""}
              onChange={(e) => studio.patch({ species: e.target.value })}
              placeholder={t("creature.speciesPlaceholder")}
              className="w-full mt-1 px-3 py-2 text-[12px] bg-[#1a1d27] border border-[#1e293b] rounded text-slate-200 placeholder:text-slate-600"
            />
            <datalist id="creature-studio-species-suggestions">
              {ANIMAL_SPECIES_SUGGESTIONS.map((a) => (
                <option key={a.id} value={a.label} />
              ))}
            </datalist>
            <span className="block mt-1 text-[9px] text-slate-600">
              {t("creature.speciesHint")}
            </span>
          </label>
          <label className="block">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">{t("common.description")}</span>
            <textarea
              value={data.description || ""}
              onChange={(e) => studio.patch({ description: e.target.value })}
              placeholder={t("creature.descriptionPlaceholder")}
              rows={3}
              className="w-full mt-1 px-3 py-2 text-[12px] bg-[#1a1d27] border border-[#1e293b] rounded text-slate-200 placeholder:text-slate-600 resize-y"
            />
          </label>
        </section>

        {/* Generate */}
        <section>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-slate-400">{t("creature.candidates")}:</span>
            <div className="flex gap-1" role="group" aria-label={t("creature.candidateCountAria")}>
              {([1, 2, 4] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCount(n)}
                  aria-pressed={count === n}
                  className={
                    count === n
                      ? "px-3 py-1.5 text-[11px] rounded bg-[#A78BFA] text-slate-900 font-medium"
                      : "px-3 py-1.5 text-[11px] rounded bg-[#1a1d27] text-slate-400 hover:text-slate-200 border border-[#1e293b]"
                  }
                >
                  {n}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void cands.generate(count)}
              disabled={generateDisabled}
              className="ms-auto px-4 py-1.5 text-[12px] rounded bg-[#ff0073] hover:bg-[#ff0073]/90 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium"
            >
              {t("common.generate")}
            </button>
          </div>
          {cands.tracked.length > 0 && (
            <div className="mt-2 text-[10px] text-slate-500">
              {cands.tracked.length === 1 ? t("creature.generatingCandidatesOne") : t("creature.generatingCandidatesMany", { n: cands.tracked.length })}
            </div>
          )}
        </section>

        {/* Candidates grid */}
        {cands.candidates.length > 0 && (
          <section>
            <h2 className="text-[12px] font-medium text-slate-300 mb-2">{t("creature.candidates")}</h2>
            <div className="grid grid-cols-2 gap-3">
              {cands.candidates.map((c) => (
                <div key={c.jobId} className="border border-[#1e293b] rounded p-2 bg-[#0e1117]">
                  <img
                    src={optimizedImageUrl(c.url, { width: 512 })}
                    alt={t("creature.candidateAlt")}
                    loading="lazy"
                    className="w-full aspect-square object-cover rounded"
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => void cands.approve(c.jobId)}
                      disabled={approveDiscardDisabled}
                      title={
                        mainImageGenPending
                          ? t("creature.waitForCandidates")
                          : undefined
                      }
                      className="flex-1 text-[11px] px-2 py-1 rounded bg-[#A78BFA] hover:bg-[#A78BFA]/90 disabled:opacity-40 disabled:cursor-not-allowed text-slate-900 font-medium"
                    >
                      {studio.isApprovingMainImage ? t("creature.approving") : t("pipe.approve")}
                    </button>
                    <button
                      type="button"
                      onClick={() => cands.discard(c.jobId)}
                      disabled={approveDiscardDisabled}
                      title={
                        mainImageGenPending
                          ? t("creature.waitForCandidates")
                          : undefined
                      }
                      className="text-[11px] px-2 py-1 rounded bg-[#1a1d27] hover:bg-[#1e293b] disabled:opacity-40 disabled:cursor-not-allowed text-slate-400"
                    >
                      {t("node.discard")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Canonical description (LLM-authored, read-only display) */}
        {data.canonicalDescription && (
          <section className="text-[11px] bg-[#0e1117] border border-[#1e293b] p-3 rounded">
            <div className="font-medium text-slate-300 mb-1">{t("creature.canonicalDescription")}</div>
            <div className="text-slate-400 italic">{data.canonicalDescription}</div>
            <div className="text-[9px] text-slate-600 mt-1">{t("creature.canonicalDescriptionHint")}</div>
          </section>
        )}
      </div>
    </div>
  )
}
