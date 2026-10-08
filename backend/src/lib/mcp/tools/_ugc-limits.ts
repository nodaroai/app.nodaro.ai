/**
 * The most job ids one `build_ugc_clips` call may list as already spent, and
 * the most its quote reads. A sampled creator is drawn by every image
 * candidate, each candidate is checked, and a re-roll draws and checks them
 * all again, so a long video can list some sixty jobs before its clips. The
 * tool's schema refuses a longer list; the quote never reads past it.
 */
export const UGC_SPENT_JOB_IDS_MAX = 64
