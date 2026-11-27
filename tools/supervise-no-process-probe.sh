#!/bin/sh
# Proves, on the BUILT image, that a program which dies while the kernel is
# refusing its supervisor a new process is started again — and that the
# supervisor is still there to do it.
#
# Why this exists (incident 2026-11-25): two renders at once used every thread
# the container may have, the proxy died of it, and for minutes nothing in the
# container could start a process. The image's shell ends at once when a start
# is refused ("Cannot fork"), so a supervisor written the plain way is gone at
# exactly that moment. start.sh's `supervise` starts its program inside
# `command eval`, where a refused start is an error status instead — a
# property of the image's own /bin/sh, which is why this runs in the image
# and not on the test runner's shell.
#
# Run it INSIDE the image, as the image's own user:
#
#   docker run --rm --entrypoint sh \
#     -v "$PWD/tools/supervise-no-process-probe.sh:/probe.sh:ro" <image> /probe.sh
#
# HOW THE REFUSAL IS MADE. Not by filling the container: a process that a dying
# program frees goes to whoever asks first, and its supervisor, woken by that
# very death, nearly always asks first — a probe built on that race passed one
# run after thirteen tries and failed the next. Instead the supervisor's own
# shell is given a limit of ONE process for its user (`ulimit -p`, the
# per-user process limit). The limit counts the processes the user already
# has, and the shell is one of them, so the kernel refuses every start that
# shell asks for: the same error from the same system call as at the
# container's process limit, with nothing left to chance. The limit is set and
# lifted from inside that shell, by a `sleep` function that runs in its place
# on the supervisor's own backoff; `supervise` itself is the function start.sh
# defines, read out of the image and not changed.
#
# What is checked: the supervisor is refused a start and says so, keeps trying
# while every start is refused, never reports itself lost, starts the program
# again once a start is allowed, and still stops cleanly.

START_SH="${1:-/app/start.sh}"
WORK="${TMPDIR:-/tmp}/supervise-probe.$$"
REFUSED_WORDS="could not be started: no process is free"
# How long every start stays refused after the first refusal: the supervisor has to outlive more than one.
HOLD_REFUSED_S=5

fail() {
  echo "FAIL: $1"
  if [ -s "$WORK/supervisor.log" ]; then
    echo "--- supervisor output ---"
    sed 's/^/  /' "$WORK/supervisor.log"
  fi
  exit 1
}

# Asks the condition $2 every tenth of a second for up to $1 seconds; fails when it never held.
wait_for() {
  tenths=$(( $1 * 10 ))
  while ! "$2"; do
    tenths=$((tenths - 1))
    if [ "$tenths" -le 0 ]; then return 1; fi
    sleep 0.1
  done
  return 0
}

program_started() {
  read -r first 2>/dev/null < "$WORK/program.pid" && [ -n "$first" ] && kill -0 "$first" 2>/dev/null
}

# The supervisor said it could not start the program — or something else ended the wait: it is gone, or the program is back.
refused_or_not() {
  grep -q "$REFUSED_WORDS" "$WORK/supervisor.log" 2>/dev/null && return 0
  kill -0 "$supervisor" 2>/dev/null || return 0
  read -r back 2>/dev/null < "$WORK/program.pid" && [ -n "$back" ] && [ "$back" != "$first" ] && kill -0 "$back" 2>/dev/null
}

# The program runs as another process than the one that was ended.
program_back() {
  read -r second 2>/dev/null < "$WORK/program.pid" && [ -n "$second" ] && [ "$second" != "$first" ] && kill -0 "$second" 2>/dev/null
}

mkdir -p "$WORK" || { echo "FAIL: cannot create $WORK"; exit 1; }
if [ "$(id -u)" = "0" ]; then
  fail "run this as the image's own user: the kernel does not hold root to the per-user process limit, so no start would be refused"
fi
sed -n '/^supervise() {/,/^}/p' "$START_SH" > "$WORK/supervise.sh"
[ -s "$WORK/supervise.sh" ] || fail "$START_SH defines no supervise()"
. "$WORK/supervise.sh"

REPORTED=""
trap 'REPORTED=1' USR1

# The supervised program: says which process it is, then stays up.
printf '%s\n' "echo \$\$ > \"$WORK/program.pid\"; exec sleep 1000" > "$WORK/program.sh"
echo allow > "$WORK/mode"

# The supervisor, in a shell with one thing added: before each backoff it sets
# how many processes its user may have — one while $WORK/mode says "refuse",
# what it was before otherwise. With one, the kernel refuses this shell every
# start, the backoff's own `sleep` included (the supervisor then counts the
# wait off /proc/uptime, as it does in a container with no process free).
(
  allowed=$(ulimit -S -p)
  sleep() {
    read -r mode 2>/dev/null < "$WORK/mode"
    if [ "$mode" = refuse ]; then ulimit -S -p 1; else ulimit -S -p "$allowed"; fi
    command sleep "$@"
  }
  SUPERVISE_DELAY=2 supervise program sh "$WORK/program.sh"
) > "$WORK/supervisor.log" 2>&1 &
supervisor=$!
first=""
wait_for 15 program_started || fail "the supervised program did not start"

# From its next backoff on, the supervisor is refused every start. End the program.
echo refuse > "$WORK/mode"
kill "$first"
wait_for 30 refused_or_not || fail "the program was ended and the supervisor neither started it again nor said that it could not"
if ! kill -0 "$supervisor" 2>/dev/null; then fail "the supervisor ended when its start was refused"; fi
grep -q "$REFUSED_WORDS" "$WORK/supervisor.log" \
  || fail "the program was started again although every start should have been refused — the kernel did not hold this user to the process limit"
echo "a start was refused: the supervisor said so and is still there"

# Every start stays refused for a while: the supervisor has to keep trying, not end and not give up.
sleep "$HOLD_REFUSED_S"
if ! kill -0 "$supervisor" 2>/dev/null; then fail "the supervisor ended while its starts were being refused"; fi
if [ -n "$REPORTED" ]; then fail "the supervisor reported itself lost while its starts were being refused"; fi
refusals=$(grep -c "$REFUSED_WORDS" "$WORK/supervisor.log")
if [ "$refusals" -lt 2 ]; then fail "the supervisor tried once and then stopped trying ($refusals refused start in ${HOLD_REFUSED_S}s)"; fi
if program_back; then fail "the program ran while every start should have been refused (pid $second)"; fi

# A start is allowed again.
echo allow > "$WORK/mode"
wait_for 30 program_back || fail "the program was not started again once a start was allowed (the one ended was pid $first)"
if [ -n "$REPORTED" ]; then fail "the supervisor reported itself lost"; fi

kill -TERM "$supervisor"
wait "$supervisor"
status=$?
if [ "$status" -ne 0 ]; then fail "the supervisor left with status $status on a shutdown"; fi
if [ -n "$REPORTED" ]; then fail "a shutdown was reported as a lost supervisor"; fi
grep -q "stopped (drained)" "$WORK/supervisor.log" || fail "the supervisor did not drain its program on a shutdown"

echo "--- supervisor output ---"
sed 's/^/  /' "$WORK/supervisor.log" | awk '{ seen[$0]++; if (seen[$0] <= 2) print; else if (seen[$0] == 3) print "  (the same line again …)" }'
rm -rf "$WORK"
echo "PASS: $refusals starts were refused over ${HOLD_REFUSED_S}s, the supervisor outlived them, and the program runs again (pid $first -> $second)"
