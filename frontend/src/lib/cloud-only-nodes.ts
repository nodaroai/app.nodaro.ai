/**
 * Node types that must only appear in Cloud edition (`hasCredits()`).
 *
 * Single source of truth for `add-node-popup.tsx` and `node-toolbar.tsx` —
 * both filtered their own hand-copied `Set` before this module existed,
 * which is exactly the "remember to update two lists" trap the root
 * CLAUDE.md coding standards warn against. Add a new cloud-only node type
 * here once; both surfaces pick it up automatically.
 */
export const CLOUD_ONLY_NODE_TYPES: ReadonlySet<string> = new Set([
  "voice-changer-pro",
  "generate-video-pro",
  "edit-video-pro",
  // video-analysis's backend implementation moved to @nodaroai/cloud-plugins
  // (loads on Cloud only), so the node is now Cloud-only too — without this the
  // node would still render on community/business but 404 on run. NOTE: unlike
  // the three above (born cloud-only), video-analysis was previously available
  // on community/business self-hosts; this gating is the consequence of moving
  // its code private.
  "video-analysis",
])
