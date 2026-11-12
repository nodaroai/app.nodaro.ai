/**
 * Who this process is, for a log line that judges a run by what this
 * process's queue holds. "No orchestrator job in queue" is only ever as true
 * as the Redis THIS process is holding, so such a line that doesn't name the
 * process is not diagnosable. That is exactly what happened on 2026-09-15:
 * three live production executions were marked orphaned and NO deployment
 * that runs this code had logged a tick, because `skipped` is (deliberately)
 * not in the tick-log gate and the owning environment's cron had simply
 * skipped them. Identifying the writer then took a log crawl across six
 * containers and still failed.
 */
import os from "node:os"
import { getRuntimeEnv } from "../runtime-env.js"

export function processIdentity(): string {
  return `${getRuntimeEnv()}/${process.env.RAILWAY_ENVIRONMENT_ID ?? os.hostname()}`
}
