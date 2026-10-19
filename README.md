# my-agy-delegate

A local Codex skill for sustained engineering work through Antigravity CLI (`agy`).
Codex is the technical supervisor; AGY is the executor that can perform multiple
edit/build/test/benchmark loops within a dispatch. Continue a coherent Task through
an explicit AGY conversation ID, with independent Codex reviews at useful checkpoints.

## Setup

Requires Node.js 18+, Git, and an authenticated Antigravity CLI with native headless JSON.
Install this directory as `my-agy-delegate` under your Codex skills directory
(`$CODEX_HOME/skills`, normally `~/.codex/skills`). This repository does not install
AGY, configure authentication, or grant permissions.

## Usage

Ask Codex to use `my-agy-delegate`, define a broad engineering goal and a stage
objective, and prepare a JSON contract outside the working repository. See
[the protocol](references/protocol.md) for the contract and continuation format.

```sh
node /path/to/my-agy-delegate/scripts/relay.mjs \
  --contract /path/to/stage.json --state-root /path/to/external-state
```

For continuation, provide the explicit conversation ID in the contract and pass
`--previous-run /path/to/latest-execution`. The relay dispatches once and never
replays automatically. Codex reviews the resulting code and test/experiment evidence.

## Limitations and development

POSIX process lifecycle only; scope audit is observation, not an OS security sandbox.
Expected paths may evolve; explicit forbidden boundaries remain enforced. Real CLI
permissions still control writes and commands. No MCP server, daemon, session registry,
automatic permission escalation, or task-wide dispatch limit is included.
See [runtime details](references/runtime.md) for artifacts and failure handling.

Run deterministic tests with `node --test tests/runtime.test.mjs`; fixtures use fake
AGY executables and disposable Git repositories. Process timeout coverage takes time.
The runtime derives from MIT-licensed delegate-skills; see LICENSE and source attribution.
