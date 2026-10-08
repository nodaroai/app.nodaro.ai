/** What the editor hands a review inspector, the cut review's and the Clip Pack's alike. */
export interface ReviewInspectorProps {
  readonly open: boolean
  /** The render the review is anchored at. */
  readonly renderId: string
  readonly onClose: () => void
  /** The reviewer chose another render of the same plan in the header's picker. */
  readonly onRenderChange?: (renderId: string) => void
}
