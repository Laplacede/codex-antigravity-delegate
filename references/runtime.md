# Relay runtime

## Scope and provenance

The two scripts are a single-dispatch POSIX runtime, not a task service. relay.mjs
adapts the native AGY interface and owns its process group. audit.mjs validates
contract shape and reads Git/content evidence; it never repairs files or runs tests.
No MCP, daemon, scheduler, parallel pool, session registry, memory database, policy
engine, automatic handoff summary or autonomous retry is included.

The process lifecycle derives from MIT-licensed delegate-skills, commit
3aa72d681a79e2a9d09bd9a316353003ae1cb4a7; LICENSE retains attribution. The upstream
checkouts are references, not runtime dependencies. Actual deterministic/E2E results
belong in validation reports, not a second list of compatibility claims here.

## Invocation and control flow

```bash
node /absolute/my-agy-delegate/scripts/relay.mjs \
  --contract /absolute/stage.json \
  --state-root /absolute/external-state \
  --previous-run /absolute/latest-execution
```

Omit --previous-run for the first dispatch. Keep one state root for the project.
Optional --model and --effort low|medium|high preserve the user's configured defaults
when absent. No permission bypass, latest-session lookup or installation is provided.

Actual control flow:

```text
load contract → check task/session and current Git → create attempt
→ version/help preflight → reserve execution → dispatch AGY exactly once
→ capture raw output → collect after/scope evidence → publish result
→ supervisor checkpoint outside relay
```

The initial workspace must be clean. Task identity freezes only workspace, goal and
forbidden paths; expected paths and acceptance/verification/temporary stage parameters
are mutable. The minimum safety constraints are validated on every dispatch. Later stages
can use a new explicit supervisor baseline after a checkpoint. Snapshots are captured
before and after each dispatch; Git changes during preflight stop dispatch. The scope
audit covers cumulative changes against the supplied base, including pre-existing
uncommitted edits. Changes outside expected paths are reported in observations and
do not require a new baseline merely to continue. The relay never
stashes/resets/cleans or infers who made an uncommitted edit.

One cooperative lock per state root prevents a second relay execution. History is
read from attempt manifests; an execution reservation with no result stops continuation.
A preflight-only attempt consumes no execution and does not become a session source.
Continuation needs the latest execution, a stopped process, usable after evidence
and no hard audit violations. Permission authorization is described in protocol.md.
Normal stage continuation has no dispatch-count limit.

Fresh AGY argv:

```text
agy --new-project --add-dir ABSOLUTE_WORKSPACE --output-format json
    --print-timeout Ns --log-file ABSOLUTE_LOG --print=CONTRACT_PROMPT
```

Resume uses --conversation EXPLICIT_ID instead of new-project/add-dir. cwd is the
contract workspace. Optional sandbox/model/effort are argv values, never shell text.
The prompt is a generic executor instruction plus the full normalized contract and
stage brief, limited to 120 KiB. No prior reports or transcripts are automatically
summarized. Tests/benchmarks follow the contract and actual permissions, not a fixed
executor-verification mode. Wait using the shell tool's execution handle; do not
redispatch because a tool detached. Allow contract timeout plus 90 seconds on the host.

## Output and process behavior

Native JSON must have string conversation_id, status and response fields; unexpected
shape or malformed output is preserved and fails closed. A requested conversation ID
must match the returned one. Unknown extra native fields remain intact. Diagnostic
classification reads stderr/native error, not the agent report. Native SUCCESS/exit 0
alone do not prove completion; permission denials, partial output, hard audit violations and live
descendants prevent execution_completed. Only the supervisor can accept stage claims.

Headless help may put normal output on stderr: preflight captures both streams and
records the command, exit/signal/error and raw streams. A failed preflight never
launches an agent. There is no format fallback, PTY fallback or second dispatch.

argv spawn leads a separate POSIX process group. Watchdog runs at contract timeout
plus 60 seconds, escalating TERM to KILL after 10 seconds; cancellation forwards signals
and escalates after 2 seconds. Exit drains inherited pipes for 500 ms. Unknown surviving
descendants retain the lock. Never adopt/kill a persisted arbitrary PID; inspect the
original job before clearing stale state. No automatic process adoption is implemented.

## Artifacts and limitations

Each unique <state>/<workspace-hash>/<task_id>/<attempt_id>/ holds:

- manifest.json: normalized contract (including requested conversation), selected dials,
  start time, execution reservation, process/version metadata and the unique before checkpoint.
- result.json: execution_status, native_result (including returned conversation ID),
  process outcome, the unique after checkpoint and audit conclusion, finish/error/relay exit.
- preflight.json: raw capability diagnostics, when the help probe was reached.
- stdout.json and stderr.log: exact bytes collected incrementally; stdout may be invalid JSON.
- verification.log: supervisor checkpoint evidence/decision; not read or accepted by relay.
- agy.log: AGY debug output, when produced; not a separate task-state source.

Manifest/result publication is atomic. Raw streams survive partial execution. Old
attempts are never overwritten; manifests are updated only for their own live dispatch.
No acceptance flag, copied agent report, task binding cache or correction counter is
stored. This development revision does not migrate the earlier internal artifact layout;
historical E2E evidence remains historical and must not be edited into the new format.

Git content/index fingerprints detect edits invisible to status text. Audit checks
expected-path hits, additional paths, forbidden paths, additions/deletions/renames and
HEAD/branch changes. Only explicit forbidden hits, inconsistent workspace/HEAD/branch,
symlink-ancestor uncertainty or unavailable evidence fail the audit; scope clean may
still contain observations. This is not an OS security boundary. It cannot see
reverted writes, ignored files, other worktrees,
all Git metadata writes, external effects or detached processes. Unsupported nested
repositories fail evidence collection. Review commands/hooks and actual CLI grants.

Raw logs can contain project data; state directories are private and no environment
or credential dumps are intentionally recorded. No automatic retention or cleanup.
