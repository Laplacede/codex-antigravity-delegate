# Delegation protocol v1

Read this before the first implementation task, and revisit the relevant part on
correction, recovery or acceptance. One task, one executor, explicit boundaries,
preserved evidence, independent supervisor verification.

## Contract

The relay takes a UTF-8 JSON contract (`--contract`). JSON is the canonical input;
each attempt stores a readable `contract.md` containing that exact normalized JSON.
Use an absolute input path outside the business repository. Replace the example
values with real project facts, full commit ID and actual local verification commands.
No secrets, tokens, credentials or complete environment dumps belong in a contract.

```json
{
  "schema": "my-agy.contract.v1",
  "task_id": "refund-idempotency",
  "attempt_id": "initial-001",
  "workspace_absolute_path": "/absolute/repository",
  "base_commit": "0000000000000000000000000000000000000000",
  "conversation_id": null,
  "permission_profile": "authorized-local-write",
  "authorization_scope": "User authorized local implementation of this task; no external mutations.",
  "capability_review": "Supervisor checked inherited plugins/MCP/tools and their permissions; describe actual findings here.",
  "sandbox": false,
  "timeout": 1800,
  "corrective_attempts_used": 0,
  "goal": "Make refund submission idempotent for the existing idempotency key.",
  "context": "Relevant entry point, verified current behavior and applicable AGENTS.md paths.",
  "owned_files": {
    "paths": [
      {"path": "services/billing/refund.py", "kind": "file"},
      {"path": "tests/billing", "kind": "directory"}
    ],
    "allow_new_files": true
  },
  "forbidden_files": [
    {"path": "tests/billing/fixtures.py", "kind": "file"},
    {"path": "migrations", "kind": "directory"}
  ],
  "constraints": {
    "no_commit": true,
    "no_push": true,
    "no_dependency_install": true,
    "no_external_writes": true,
    "no_permission_escalation": true
  },
  "acceptance_criteria": ["Repeated submission uses the same refund without charging twice."],
  "verification_commands": [
    {"cwd": "/absolute/repository", "command": "pytest tests/billing -q", "expected": "Exit 0; idempotency regression and existing tests pass."}
  ],
  "output_contract": [
    "Root cause or concise reasoning summary; no private chain-of-thought.",
    "Modified files and why.",
    "Validation actually run, commands, exit codes and results.",
    "Unresolved issues and blocker, or explicitly none."
  ]
}
```

Fields map to Goal, Context, Owned Files, Forbidden Files, Constraints, Acceptance
Criteria, Verification Commands and Output Contract. Extra machine metadata identifies
the task, attempt, code baseline, conversation, permission and time/correction budgets.

Paths are repository-relative literals: `file` means exactly one path; `directory`
means itself and descendants. No globs, absolute paths, `..`, `.git` or backslash paths.
**Forbidden overrides owned**, including a forbidden file inside an owned directory.
The new-file switch applies to all owned paths. Both sides of renames are audited.
The relay validates shape and minimum constraints; Codex must ensure the report
contract actually requests the five report elements above and the task is meaningful.

## Dispatch and wait

```bash
node /absolute/my-agy-delegate/scripts/relay.mjs \
  --contract /absolute/contracts/refund-initial.json \
  --state-root /absolute/external-state/my-agy-delegate
```

Optional `--model LABEL` and `--effort low|medium|high` are explicit user/task choices;
otherwise AGY's configured default is preserved. No installation or authentication is
performed by the relay. First confirm the authenticated CLI works independently.

Use the shell tool's execution/session handle to wait, with a host timeout longer
than the contract timeout plus 90 seconds (preflight, drain and termination allowance).
No model-driven log polling is needed. A tool detaching from a process is different
from canceling it: do not redispatch while the original execution remains alive.

The relay only handles `authorized-local-write`. Its state/artifact files and AGY's
own conversation/cache files are expected runtime writes outside the code ownership
list; `no_external_writes` prohibits delegated project-external work/account mutations,
not the CLI's necessary local state. No permission bypass flag or global permission
configuration change is provided. Sandbox is an optional terminal restriction only.
Commands, tests, project hooks and inherited tools may themselves have side effects;
review these before authorizing execution. A prompt/scope audit cannot enforce them.

## Session lifecycle

Bindings persist workspace realpath, base commit, goal, owned/forbidden paths,
constraints, acceptance/verification/output contracts, permission profile,
authorization, capability review and sandbox setting.
Task binding must remain unchanged across corrections. JSON field order is compared
conservatively; use the original contract as the source for corrections.

For an explicit resume use the previous native result's trusted `conversation_id`
and `--previous-run` for a correction, or `--session-from /absolute/previous/run` for
a new task that has an identical binding. The source must have a finished process
and an after fingerprint matching current Git state. No CLI-log parsing or latest
conversation lookup is used. A missing/untrusted/mismatched ID is rejected; after
audit, set `conversation_id` to null to start fresh. No hidden fallback/replay occurs.

Keep the same conversation for a coherent goal and compatible code/permission state.
Start fresh on goal/workspace/permission change, context pollution, or independent
review. The full contract accompanies every delta so key boundaries are restated.
Changing conversations does not reset the task's persisted attempt count.
Git is code-state truth; the conversation is reasoning context.

The state root has a single-executor lock. Keep the default root or one agreed root
for every invocation; alternate roots/manual AGY processes are outside that lock.
Do not run a second writer, even from another Codex chat. Do not treat the lock as
distributed scheduling or as a defense against an agent with local filesystem access.

## Corrections and recovery

Initial attempt uses `corrective_attempts_used: 0`. First correction uses 1, second
uses 2. An attempt ID cannot be reused. Counters are checked against persisted
execution reservations, not conversation IDs; no fourth execution is allowed.
A reservation made immediately before spawn counts conservatively if interrupted.
Preflight-only failures keep artifacts but do not consume execution budget.

For a correction add:

```json
"correction": {
  "observed_failure": "Targeted regression still fails at the retry boundary.",
  "evidence": "New exact failure output and relevant diff/test evidence or their artifact paths.",
  "expected_behavior": "Second submission returns the original refund.",
  "rerun_command": "pytest tests/billing/test_refund.py -q",
  "process_confirmed_stopped": true,
  "external_side_effects_clear": true
}
```

Pass `--previous-run` with the latest execution attempt directory. Current Git must
match its saved after evidence. AGY receives the correction plus unchanged boundaries.
The supervisor must check that evidence is new and informative; the relay can only
check required fields and reject exact evidence reuse. Two corrections are a maximum,
not a target. Stop earlier if the same approach makes no useful progress.

`retry_blocker` prohibits automatic continuation/retry; it does not mean the task
can never recover. No automated correction follows a permission blocker,
authentication, permission escalation, quota, network uncertainty, unsupported
protocol, scope violation or unknown process state. Do not use a new task ID,
state root or changed history to bypass these gates.

### Explicit permission recovery

Only `permission_blocked` has a supervisor-authorized recovery path in v1:
permission_blocked → explicit human authorization for a specific permission change
→ external permission remediation by the supervisor/user → explicit relay dispatch.
The relay does not change settings, grant permissions, or automatically dispatch.
The supervisor must confirm actual human authorization and completed remediation;
metadata is an attestation, not proof of consent or an enforcement mechanism.

Add this metadata alongside the existing evidence-based `correction` object:

```json
"recovery": {
  "from_attempt_id": "attempt-002",
  "reason": "permission_blocked",
  "authorization": "explicit-user-approval",
  "change": "Supervisor added the two exact file write permissions approved by the user."
}
```

Use `--previous-run` for the latest execution in the same task, with
`conversation_id: null` and no `--session-from`. Permission change requires a new
conversation. Keep the entire task binding unchanged, including workspace, goal,
base, ownership, forbidden paths, constraints and acceptance/verification contracts;
describe the external permission remediation in `recovery.change`.

Recovery requires a stopped previous execution with `execution_started: true`,
`execution_status: permission_blocked`, `retry_blocker: true`, and a clean scope
audit. Current Git fingerprint must match its saved after evidence. The existing
corrective brief must contain new evidence and confirm stopped processes and clear
external side effects. Other blockers, unknown processes, scope violations and
uncertain side effects remain hard stops; this is not a generic override.

Every reserved execution counts, including a permission denial before any edits.
Thus after initial attempt-002, attempt-003 uses `corrective_attempts_used: 1`.
Recovery consumes a corrective execution under the same initial-plus-two limit;
neither permission changes nor fresh conversations reset the budget. Old manifests,
results and blocker history are never modified. Reject invalid recovery metadata
even if the prior result would otherwise permit a normal correction.

After timeout/crash/cancellation:

1. Confirm the original process and owned descendants are stopped. Never kill/adopt
   an arbitrary persisted PID: PIDs can be reused. Inspect live identity first.
2. Inspect raw stdout/stderr, manifest and Git evidence. Use a fresh audit, read all
   partial edits, staged changes, untracked files and any uncertainty about external
   actions. Record the conclusion; the two boolean attestations above are required
   for any abnormal-result correction and are not automatically inferred from a log.
3. If result/after evidence is missing, a lock is stale, or Git differs from the
   saved snapshot, stop automated execution. Preserve the directory. Supervisor can
   finish/replan manually; v1 has no automatic repair/adoption tool. Remove a stale
   `.active` directory manually only after confirming its job is gone. Removing the
   lock does not bypass missing-result, binding or budget checks.
4. Only a known stopped attempt, in-scope edits and new corrective evidence permit
   another execution under the same budget. A normal failure is never an automatic
   replay, nor permission to increase scope or timeout silently.

## Git evidence and independent verification

Relay stores before/after evidence and a scope audit automatically. For fresh recovery
evidence the supervisor may use these read-only commands (stdout is JSON):

```bash
node /absolute/my-agy-delegate/scripts/audit.mjs before /absolute/contract.json
node /absolute/my-agy-delegate/scripts/audit.mjs after /absolute/contract.json /absolute/run/before.json
```

Audit reads repository root, branch, HEAD, staged/unstaged changes and untracked
files, plus file-content fingerprints. It records additions, deletions, renames and
committed differences. Detached HEAD is supported. Unexpected HEAD/branch changes,
forbidden paths, paths outside ownership and prohibited new files are violations.
Unusable evidence is an error, never `scope clean`. Audit does not run tests, repair,
reset, clean, checkout, revert, merge or commit.

Before accepting:

1. Compare before/after/audit; review `git diff`, `git diff --cached`, all untracked
   contents, HEAD/branch changes and ownership. A normal diff alone omits staged/new files.
2. Review existing test deletions/skips, weakened assertions and tolerances, test
   configuration, package scripts and executable hooks before trusting green checks.
3. Independently rerun the key reproducer/targeted tests and necessary build/typecheck
   from the specified cwd. Inspect commands instead of blindly executing AGY's report.
4. Check every acceptance criterion and unresolved decision. Green tests alone are
   insufficient. Record command/cwd/exit/result and the code fingerprint tested in
   `verification.log`; record the supervisor's `accepted` decision there only when justified.

Relay always leaves `acceptance: pending_supervisor_verification`, including after
an execution completed. It never writes an accepted task state. If code changes
after verification, rerun the affected checks. Run the full integration checks when
needed at the end, rather than repeatedly duplicating expensive tests on unchanged code.

## Worktree and context

Use a clean single-writer workspace. With user edits, concurrent work or experimental
isolation, the supervisor creates a worktree from an explicit commit. Uncommitted
changes do not transfer automatically. Resolve needed changes explicitly, without
silently committing/resetting the user's files. AGY does not create/merge/delete
worktrees. Worktrees share Git administration and are not security sandboxes.

Applicable AGENTS.md holds durable project rules. AI_HANDOFF.md, when the project
uses it, holds goal, baseline, verified progress, blocker, next step and artifact
paths. It is a convention, not an automatically loaded cross-agent database. Codex
updates it after verification, and reconciles it with Git on resume. Keep project
facts out of this skill, and keep raw transcripts out of handoff.

## Artifacts

Default root: `~/.local/state/my-agy-delegate`; override only with an agreed external
root. Layout: `<root>/<workspace-hash>/<task_id>/<attempt_id>/` containing:

- `contract.md`, `manifest.json`: normalized input, binding, baseline, version,
  selected dials, process identity and attempt budget; no environment dump.
- `stdout.json`, `stderr.log`, optional `agy.log`: preserved raw execution evidence;
  partial/malformed stdout keeps its filename and is not necessarily valid JSON.
- `before.json`, `after.json`, `audit.json`: deterministic Git evidence.
- `result.json`: atomically published execution envelope and agent report, distinct
  from supervisor acceptance.
- `verification.log`: initially empty; supervisor records actual independent checks.

State directories are private to the user. Do not put secrets in prompts/logs;
raw tool output can contain sensitive project data. Review before sharing artifacts.
Failed attempts are retained. No automatic retention pruning is implemented; clean
up only after verified work is safely retained. Missing results require recovery.
Logs are evidence for debugging, not a tamper-proof record or model context payload.
