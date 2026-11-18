import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  COMPETITOR_SCAN_PAGE_CREDIT_ID,
  COMPETITOR_SCAN_SEARCH_LIMIT,
  COMPETITOR_SEARCH_TERMS_MAX,
  competitorScanPages,
  competitorScanSearches,
  type CreateCompetitorInput,
  type TrackedCompetitor,
} from "@nodaro/shared/social"
import { useCompetitorLimits } from "@/hooks/queries/use-competitors-queries"
import { discoverCompetitor } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { emptyForm, formFrom, inputFrom, mergeDiscovery, termCapOf, type CompetitorFormState } from "./competitor-form"
import { useScanPagesPrice } from "./scan-price"
import { addTerms } from "./search-terms-field"

/**
 * The brand form's state while its dialog is open: the fields, a search term
 * typed and not added yet, the website lookup, the plan's cap on terms, and
 * one list of terms that both the price and Save read (what Save sends is
 * what was priced).
 */
export function useCompetitorForm(open: boolean, editing: TrackedCompetitor | null) {
  const t = useT()
  const [form, setForm] = useState<CompetitorFormState>(emptyForm)
  const [termDraft, setTermDraft] = useState("")
  const [finding, setFinding] = useState(false)
  // Bumped whenever the form is (re)filled or a lookup starts: a lookup that
  // answers after that belongs to another form, and is dropped.
  const lookup = useRef(0)
  // The plan's caps; none from a server older than search terms, which then offers no terms.
  const limits = useCompetitorLimits(open).data ?? null
  const termCap = termCapOf(limits)
  const cap = termCap ?? COMPETITOR_SEARCH_TERMS_MAX

  useEffect(() => {
    lookup.current += 1
    setFinding(false)
    setTermDraft("")
    if (open) setForm(editing ? formFrom(editing) : emptyForm())
  }, [open, editing])

  // The terms Save sends: the chips, and the one still being typed, within the cap.
  const terms = limits ? addTerms(form.searchTerms, termDraft, cap) : []
  // A scan's pages: one per account, one per about-platform per term the plan lets it search.
  const scan = { accounts: form.accounts, aboutPlatforms: form.aboutPlatforms, searchTerms: terms, termCap }
  const pages = competitorScanPages(scan)
  // More searches than one scan may run: the server refuses to save it, so Save waits until terms or platforms go.
  const searches = competitorScanSearches(scan)
  const tooBig = searches > COMPETITOR_SCAN_SEARCH_LIMIT
  const credits = useScanPagesPrice(COMPETITOR_SCAN_PAGE_CREDIT_ID, pages)
  const input = (): CreateCompetitorInput => inputFrom({ ...form, searchTerms: terms }, limits !== null)

  const findAccounts = async () => {
    const website = form.website.trim()
    if (!website) return
    const ticket = ++lookup.current
    setFinding(true)
    try {
      const found = await discoverCompetitor(website)
      if (ticket === lookup.current) setForm((cur) => mergeDiscovery(cur, found))
    } catch (err) {
      if (ticket === lookup.current) toast.error(err instanceof Error ? err.message : t("apiErr.discoverCompetitor"))
    } finally {
      if (ticket === lookup.current) setFinding(false)
    }
  }

  return { form, setForm, termDraft, setTermDraft, finding, findAccounts, limits, cap, unlimited: termCap === null, pages, searches, tooBig, credits, input }
}
