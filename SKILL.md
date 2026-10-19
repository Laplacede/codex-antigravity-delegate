---
name: my-agy-delegate
description: Delegate sustained engineering work such as operator optimization, performance experiments, complex bugfixes and multi-stage development to Antigravity CLI (agy). Codex sets direction and reviews checkpoints; AGY performs authorized edit/test/benchmark loops in a continuing explicit conversation. Avoid delegation overhead for trivial edits.
license: MIT
compatibility: Node.js 18+, Git, authenticated agy with headless JSON; POSIX process lifecycle. No MCP dependency.
---

# AGY delegation

Use four concepts: **Task, Conversation, Attempt, Supervisor checkpoint**.
Codex owns technical direction, stage objectives, authorization and checkpoint review.
AGY does sustained implementation and authorized edit/build/test/benchmark loops;
one relay dispatch can contain many such loops.

Read [protocol.md](references/protocol.md) to prepare a task or continuation.
Read [runtime.md](references/runtime.md) for invocation, artifacts and failure handling.
Keep the explicit AGY conversation ID for a continuous task. Never guess a session or
use resume-last. Each next dispatch is a supervisor decision; the relay never replays.
At a stage checkpoint, inspect Git changes and experiment evidence and independently
verify the important claims before accepting them or choosing the next direction.
Task identity is the stable goal/workspace and explicit forbidden paths. Expected
files and stage targets may evolve; audit reports additions beyond expectations,
while explicit forbidden/hard boundaries still fail.

Git and experiment records are project truth. Optional PROJECT_STATE.md is a compact
cross-conversation summary owned by the supervisor, not a relay-managed database.
Do not treat a prompt, worktree or scope audit as a filesystem/permission sandbox.
