---
name: my-agy-delegate
description: Delegate bounded repository implementation and local testing to Antigravity CLI (agy), while Codex owns task boundaries, recovery, independent verification and acceptance. Use when the user asks to involve agy or authorizes this supervisor workflow. Avoid delegation overhead for trivial edits.
license: MIT
compatibility: Node.js 18+, Git, authenticated agy with native headless JSON. POSIX process lifecycle; macOS tested with fixtures. No MCP dependency.
---

# AGY delegation

Codex defines architecture, task scope and acceptance. AGY implements one bounded task
and runs local checks. Scripts collect execution evidence; only Codex can accept work.
Use the current shell/process tool to wait for completion. Read the returned result once;
do not repeatedly stream logs into model context. There is no background MCP setup.

Before implementation delegation, read [protocol.md](references/protocol.md) for the
contract and decision gates. Read [runtime.md](references/runtime.md) on first use,
version changes, abnormal output, interruption or recovery.

1. Inspect applicable project rules, Git baseline and actual test commands. Confirm
   delegated scope and authorization; review inherited AGY plugins/MCP/external tools.
2. Prepare a JSON contract outside the business repository. Use a clean, single-writer
   workspace or a supervisor-created worktree from a known commit.
3. Run `node <skill-dir>/scripts/relay.mjs --contract /absolute/contract.json`.
   Use the same external state root throughout a project. The relay enforces a single
   execution and persists the attempt. No permission bypass is exposed.
4. Wait for process completion. Inspect `result.json`, `audit.json`, staged/unstaged
   diffs and untracked contents. `execution_completed` still requires independent
   verification. Review test/config changes before rerunning critical checks.
5. Accept only after checking the acceptance criteria yourself. Record verification
   evidence in the attempt's `verification.log` and update project handoff if needed.
   If justified, send at most two evidence-based corrections under the same task ID.

`scripts/audit.mjs` can collect a fresh baseline or compare a baseline to the current
tree during recovery; it never executes tests or repairs files. See protocol commands.

Stop on changed ownership/goal/permission boundaries, unknown processes, missing
results, forbidden changes, auth/quota/network uncertainty, or new external actions.
Inspect partial work before any retry. Resume only a bound explicit conversation ID;
never use “most recent”. Do not reset retry budgets by changing conversations.

Keep project facts in project rules/contracts/handoff. Read-only enforcement is not
provided by this v1: `bypass=false`, a prompt or a worktree is insufficient. Do not use
this relay for production, destructive or external account operations.
