# Task and checkpoint protocol

## Task Contract

A Task is a continuous engineering objective, not a single edit or experiment.
Keep its goal and ownership broad enough for useful local iteration but explicit.
One Attempt records one real relay dispatch, not each internal AGY edit or test.
The Conversation is AGY's context handle; the Supervisor checkpoint is Codex's
independent assessment of a completed stage.

Write a UTF-8 JSON contract outside the business repository. For example:

```json
{
  "schema": "my-agy.contract.v1",
  "task_id": "square-tiling",
  "attempt_id": "stage-001",
  "workspace_absolute_path": "/absolute/repository",
  "base_commit": "0000000000000000000000000000000000000000",
  "conversation_id": null,
  "sandbox": false,
  "timeout": 7200,
  "goal": "Find a stable correct K-tiling or Split-K improvement for Square cases.",
  "context": "User authorized local kernel edits and existing build/test/benchmark commands. Stage objective: establish baseline, explore candidates, run repeated checks, and retain experiment evidence. Read AGENTS.md, PROJECT_STATE.md if present, and relevant experiment records. Stop on permission denial without trying alternative tools.",
  "owned_files": {
    "paths": [
      {"path": "kernels", "kind": "directory"},
      {"path": "tests", "kind": "directory"},
      {"path": "experiments", "kind": "directory"}
    ],
    "allow_new_files": true
  },
  "forbidden_files": [
    {"path": "tests/golden", "kind": "directory"},
    {"path": "AGENTS.md", "kind": "file"}
  ],
  "constraints": {
    "no_commit": true,
    "no_push": true,
    "no_dependency_install": true,
    "no_external_writes": true,
    "no_permission_escalation": true
  },
  "acceptance_criteria": [
    "Correctness remains valid and performance claims have reproducible experiment evidence."
  ],
  "verification_commands": [
    {"cwd": "/absolute/repository", "command": "bash run.sh", "expected": "Correctness checks pass; retain baseline/candidate measurements."}
  ],
  "output_contract": [
    "Changes, actual commands and results, findings, rejected directions, evidence paths, remaining blockers and next steps."
  ]
}
```

Use a real full commit ID. Paths in owned/forbidden lists are canonical repository-
relative literals, with kind file or directory; no globs, parent traversal or .git.
Forbidden overrides owned, including both sides of renames. Runtime conversation/
cache files are expected CLI writes; no_external_writes prohibits delegated work
outside the authorized project and external account mutations.

Context specifies the current stage and which commands/benchmarks AGY may run.
Verification commands describe task-wide verification intent; they are not executed
by the relay. AGY can run many authorized edit/test/inspect loops in a single dispatch.
When commands are not authorized, say so in context and have Codex verify separately.
Do not weaken ownership or acceptance to make an experiment pass. High-risk external
side effects need actual human authorization; contract text is not a permission grant.

## Continuation

Default to the same explicit conversation_id for the continuous Task. A failed
compile/test, completed experiment or permission change does not select a new session.
Codex decides whether context remains useful or a fresh conversation is needed.
There is no task-wide dispatch cap and no correction counter. Every next dispatch
requires an explicit supervisor call; the relay itself never loops or replays.

Use a new attempt_id, the latest execution directory as --previous-run, and add:

```json
"continuation": {
  "previous_result": "Stage one established a correct baseline; candidate A did not improve it.",
  "evidence": "experiments/stage-one.json contains repeated baseline/A measurements and correctness results.",
  "next_objective": "Explore candidate B and the tail path; preserve the baseline and record results."
}
```

Keep workspace, goal, owned/forbidden scope, constraints and acceptance/verification
intent unchanged. Context, report wording and other stage details can change.
Supply the current supervisor-approved base_commit; Codex can establish a new Git
baseline at a checkpoint without changing the Task or Conversation. Inspect current
Git before dispatch and describe relevant checkpoint changes in the brief. Content/
index fingerprints remain objective evidence, not a second project-state database.

A non-null conversation_id must match the latest execution's valid native result.
Null explicitly requests a fresh AGY conversation. There is no implicit ID lookup,
resume-last or automatic transfer of the old conversation's findings. For a fresh
conversation point AGY to AGENTS.md, optional PROJECT_STATE.md, experiment records
and current code; include the necessary compressed stage context yourself.

### After a permission denial

Normal continuation also requires that the external permission condition has been
repaired after explicit human approval. Add only this declaration inside continuation:

```json
"permission_change": {
  "authorization": "explicit-user-approval",
  "change": "User approved these exact local permissions; supervisor applied them outside AGY execution."
}
```

The relay checks the declaration when the previous result is permission_blocked.
It does not verify consent, edit settings, grant access or retry by itself. Codex must
confirm real authorization and completed remediation. Keep old results unchanged.
Other failures are assessed by Codex before an explicit continuation; an unknown
process, missing execution result or scope/evidence problem must be inspected first.

## Supervisor checkpoint and project context

Review at a useful stage boundary, not after each AGY internal action:

- Inspect actual diff, staged/unstaged/untracked files and ownership. Review test
  changes for skipped checks, weakened assertions or misleading benchmark changes.
- Read actual experiment records; distinguish build, path selection, correctness,
  device execution and performance. Independently rerun the important stage checks.
- Record commands/results, the tested Git fingerprint and the checkpoint decision in
  verification.log. Execution success is not supervisor acceptance.
- Choose whether to continue the same conversation, adjust the stage or stop.

Use a single-writer workspace, initially clean or isolated in a supervisor-created
worktree. Review inherited CLI tools/plugins/MCP and project hooks before allowing
commands. No permissions, installation or worktree management are performed by relay.

Project context has three simple layers:

1. Current Codex conversation and explicit AGY conversation_id.
2. Optional PROJECT_STATE.md: Current Goal/Baseline/Best, Key Findings, Rejected
   Directions, Working Hypothesis, Next Actions, Important Files, Active AGY Conversation.
3. Git and experiment records: objective code and measurement evidence.

Evidence takes precedence over PROJECT_STATE, which takes precedence over conversation
memory. PROJECT_STATE has no required schema or per-attempt update schedule. Codex is
its final owner, normally updating it at a checkpoint; AGY may read it but may only
write it when explicitly authorized. Do not promote unverified AGY claims to project
facts. New Codex/AGY conversations can recover from these project files and evidence
without the old Codex chat. The relay neither creates nor manages project memory.
