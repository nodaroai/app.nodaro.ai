/**
 * THE THREE WAYS TO CHANGE A VIDEO on the MCP lane, and the one sentence each tool says of the
 * others, so `modify_video`, `video_remake` and `start_recast` read alike:
 *
 *  - edit, modify, restyle or remake a clip (its motion kept), and transfer a clip's motion to
 *    your own cast: Video Remake (`video_remake`); `motion_transfer` stays the direct
 *    single-model call for the latter;
 *  - an instruction edit that runs at once: `modify_video`'s edit models;
 *  - recreate, reshoot or remix a whole video from zero: Recast (`start_recast`).
 *
 * A tool names another only where that other is offered to the session: the edition (both are
 * Nodaro Cloud's), the scope its registration needs, and the deployment's offer (tool-offer.ts),
 * read at registration as the tool list itself is decided.
 */
import { hasCredits } from "../../config.js"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"

const executeGate: ToolGate = { required: ["workflows:execute"] }

function offered(session: McpSession, tool: string): boolean {
  if (!hasCredits() || !passesGate(session, executeGate)) return false
  return session.offer ? session.offer.refusalOf(tool) === undefined : true
}

/** Whether `session` is offered `video_remake`. */
export const videoRemakeOffered = (session: McpSession): boolean => offered(session, "video_remake")

/** Whether `session` is offered `start_recast`. */
export const recastOffered = (session: McpSession): boolean => offered(session, "start_recast")

/** What `modify_video` and `video_remake` say of Recast, where it is offered. */
export const RECAST_POINTER =
  "To recreate, reshoot or remix a whole video from zero (longer videos, a new cast and music, the motion itself changed), use `start_recast`, not this tool."

/** What `motion_transfer` says of Video Remake, where it is offered. */
export const MOTION_TRANSFER_REMAKE_POINTER =
  "Recommended for transferring a clip's motion to your own cast: `video_remake` (Video Remake: a price quote first, then the run); this tool is the direct single-model call."

/** What `start_recast` says of Video Remake, where it is offered. */
export const VIDEO_REMAKE_POINTER = "To edit, modify, restyle or remake a clip (its motion kept), use `video_remake`, not this tool."
