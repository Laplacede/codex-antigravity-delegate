# Runtime v1

## Provenance and changes

Upstream: https://github.com/amElnagdy/delegate-skills

Baseline commit: `3aa72d681a79e2a9d09bd9a316353003ae1cb4a7`.
Directly derived file: `scripts/relay.mjs`, from
`skills/agy-delegate/scripts/relay.mjs`. LICENSE retains upstream MIT attribution.
The local audit implementation and protocol are additions. No bridge code was copied.
The two reference checkouts remain unmodified and are not runtime dependencies.

Retained upstream implementation: argv-array spawn without a shell, separate POSIX
process group, tree termination, watchdog, relay signal forwarding, delayed SIGKILL,
byte-preserving pipe capture (UTF-8 decoded after collection), abnormal child exit handling, inherited-pipe drain grace,
bounded changelog/version probe, brief byte-size guard and atomic result publication.
The byte capture replaces upstream’s duplicate in-memory decoded stdout accumulation.
Original process-boundary scenarios informed local tests; the upstream test harness
was not copied because it assumes its fleet/package layout and legacy result schema.

Removed: fleet/lane resolution, resume-last, configurable projects/additional roots,
automatic sandbox-plus-bypass read-only mapping, all bypass options, unstable-log
stall detection and log-regex session extraction, automatic commit expectations,
full report echoing and mandatory Codex background MCP. No PTY retry is provided.

Added: canonical JSON contract, private unique persistent attempts, native JSON
decoding, separate execution/report/acceptance fields, Git audit, explicit conversation
binding, persisted three-attempt cap, single-executor lock, recovery gates.
The bridge contributed only ownership, independent verification, failure retention
and bounded evidence-based correction ideas; no MCP/Python/job manager is required.

## Compatibility evidence

2026-10-18, local macOS / Node **25.9.0**: installed AGY reports **1.4.1** via `agy changelog`;
`agy --help` lists the expected headless/JSON/conversation/workspace flags. These
checks do not call an agent and do not validate authentication or write permissions.
The automated suite uses a fake AGY executable and disposable real Git repositories.
There is no authenticated model-backed end-to-end claim. Never claim all AGY versions
or all hosts are supported. Node built-ins only; no dependency installation needed.

Final validation on that host: `node --test tests/runtime.test.mjs` from this skill
directory: **37 passed, 0 failed, 0 skipped**, approximately 97.3 seconds. Includes
an actual 61-second relay watchdog wait, partial output/modifications, resistant-child
SIGKILL escalation, inherited-pipe drain, live descendant lock retention, UTF-8 split
bytes, JSON/error cases, explicit session/state mismatch, Git ownership/index/HEAD,
failed artifacts and persisted correction limits. Tests use fixtures only, no real
model calls or external project edits. Both scripts passed `node --check`.

SKILL frontmatter passed Ruby standard-library YAML parsing, required name/description
and supported-field checks. The skill-creator Python validator could not start because
the available Python lacks PyYAML; no package was installed. YAML validation is not
a behavioral evaluation. Both upstream checkouts had clean Git status after validation.

Primary interface reference: https://antigravity.google/docs/cli/headless
Native format assumptions below follow the JSON example read on 2026-10-18.
CLI behavior can change; passing `--help` is a capability hint, not proof of semantics.

Only the POSIX runtime lifecycle is supported for v1. Windows tree-kill code was
removed and execution is rejected until group ownership/recovery semantics are
independently validated. No TUI automation.

## Invocation

Fresh:

```text
agy --new-project --add-dir ABSOLUTE_WORKSPACE --output-format json
    --print-timeout Ns --log-file ABSOLUTE_LOG --print=CONTRACT_PROMPT
```

Resume replaces new-project/add-dir with `--conversation EXPLICIT_ID`. The current
cwd and the stored workspace binding must agree. Optional model/effort and sandbox
flags are explicit. There is no inherited-shell prompt expansion; prompts are argv
values and are visible to host process-list observers. Keep prompts focused and
under 120 KiB; reference workspace context instead of embedding large files.

Exactly one agent prompt is executed per dispatched attempt. The version/help
preflights do not send an agent prompt. Unsupported capability is a preflight result;
unsupported/malformed execution output is preserved without another AGY invocation.

## Native JSON and results

Expected top-level object:

```json
{"conversation_id":"opaque-id","status":"SUCCESS","response":"Agent report"}
```

Unknown extra fields are preserved (including usage); required fields must have the
documented types. A nonempty response and `SUCCESS` are necessary for
`execution_completed`, along with acceptable process exit, no diagnostic blocker
and a clean scope audit. Other native statuses fail closed. An absent/invalid ID,
wrong shape or unexpected envelope is `unsupported_protocol`. Resume returning a
different ID is `conversation_mismatch`; it is never silently rebound.

Raw stdout is retained even when empty, partial, malformed, an array or a new format.
Do not mine it with regex for a resumable ID. `agent_report` is the native response;
`cli_envelope` is the raw parsed object; `acceptance` always awaits the supervisor.

Execution statuses include `execution_completed`, `empty_output`, `malformed_json`,
`unsupported_protocol`, `native_failed`, `permission_blocked`,
`authentication_blocked`, `quota_blocked`, `network_uncertainty`,
`partial_output`, `timeout`, `aborted`, `failed`, `agy_unavailable`,
`conversation_mismatch`, `scope_violation`, `audit_failed`, `process_unknown`.
The native status is retained separately. Relay exit 0 means execution completed,
never task accepted. `process_exit_code` records the child's native exit code and
is null if there was no child or it died by signal; `signal`
records the child's termination signal and `relay_signal` records a relay interrupt.
`exitCode` is the relay's normalized nonzero failure code.

Diagnostic classification scans stderr/native error, never the report text, using
conservative patterns. A soft permission denial, partial-output/timeout notice or
uncompleted background task cannot become execution success merely through exit 0.
Patterns cannot cover every future AGY diagnostic; the independent review remains
mandatory. False-positive conservative failure is possible. No format fallback.

## Permissions

An explicit `recovery` contract may cross only a stopped, scope-clean
`permission_blocked` retry gate after supervisor-attested human authorization and
external permission remediation. It requires a fresh conversation, the latest
`--previous-run`, unchanged binding/Git state and the existing corrective evidence
and budget checks. See protocol.md; other blockers remain hard stops. No settings
or historical results are modified and no automatic dispatch is introduced.

No dangerous bypass flag is accepted or inferred. `permission_profile` supports
authorized local writes only. Neither default settings, sandbox nor scope audit is
a read-only guarantee. Unapproved operations must return a blocker. Inherited AGY
settings, plugins, MCP, external tools, shell aliases/hooks and test commands remain
part of the supervisor's capability review; this runtime does not reconfigure them.
An ownership prompt cannot prevent all external side effects. High-risk mutations
are outside ordinary delegation and require a concrete human authorization step.

## Timeouts, cancellation and recovery

The contract timeout is passed to AGY. The retained relay watchdog expires after
that deadline plus 60 seconds so a stuck AGY cannot wait forever. Cancellation uses
SIGTERM/SIGINT/SIGHUP forwarding and escalates to SIGKILL. Wall timeout escalates
after 10 seconds. Parent exit allows 500 ms for inherited pipe drain. The raw output
is saved incrementally, even if the relay later receives an uncatchable SIGKILL.

An owned POSIX process group still alive at result time yields `process_unknown`
and retains the lock. A normal parent's exit does not prove descendants have stopped.
A canceled/timed-out group is swept with SIGKILL before publishing; process state
remains conservative if descendants have not yet disappeared. Processes that detach
themselves from the group are outside the containment guarantee. No stored PID is
automatically adopted/killed on restart. No daemon/subagent lifecycle is implemented.

If the relay crashes, result/audit may be absent and `.active` may persist. Preserve
the attempt, confirm live process identity and Git state, then use the supervisor
recovery procedure in protocol.md. Do not rerun, change formats or bypass permissions.

## Evidence boundaries and complexity audit

Audit covers current tracked files and nonignored untracked files, staged/unstaged
changes, committed differences and branch/HEAD. It cannot observe a write reverted
before collection, ignored files, other worktrees, Git admin changes that leave these
signals unchanged, network effects or detached processes. Nested repositories and
submodules fail evidence collection rather than pretending full coverage. Symlink
ancestors of changed paths are violations. Tests/commands are never executed by audit.

Final file-by-file deletion check:

| File | Why retained |
| --- | --- |
| SKILL.md | Discoverable entry point and essential supervisor decisions. |
| scripts/relay.mjs | Process ownership, capture, timeout/cancellation, native result and recovery lifecycle. |
| scripts/audit.mjs | Shared deterministic Git/scope evidence, also usable during manual recovery. |
| references/protocol.md | Contract, independent acceptance and session/correction decisions kept out of SKILL. |
| references/runtime.md | Version/provenance, tested assumptions, failure boundaries and recovery details. |
| LICENSE | Required attribution for directly derived code. |
| tests/runtime.test.mjs | Development-only behavior checks for fragile process/Git/protocol invariants. |

Required mechanisms retained: atomic results prevent partial reads; unique directories
prevent overwrite/replay ambiguity; the execution lock prevents cooperative concurrent
writers; persisted attempts prevent conversation-based budget reset; bindings and Git
content/index fingerprints prevent stale resume; raw output preserves partial failures;
the owned-group check avoids claiming completion with a live descendant. Independent
verification remains a supervisor decision, so there is no acceptance script or agent.

Deleted unnecessary code during this pass: unused duration parser, unsupported Windows
tree-kill path, unstable-log stall watcher and duplicate in-memory stdout/stderr buffers.
No schema engine, task service, project database, installer, parallel pool or UI exists.

v2 only: concurrent AGY tasks/DAG, fleet/model routing, persistent stdin sessions,
stream UI/tool analysis, subagent tracking, background MCP, automatic worktree pools,
merge/push automation, a second reviewer, cross-platform validation or automatic
recovery/adoption. None is required for the v1 single-task path.
