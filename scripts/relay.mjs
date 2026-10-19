#!/usr/bin/env node
/**
 * Controlled derivative of delegate-skills agy-delegate relay.mjs (MIT).
 * Copyright (c) 2026 Ahmed Mohammed (amElnagdy).
 * Upstream: https://github.com/amElnagdy/delegate-skills
 * Commit: 3aa72d681a79e2a9d09bd9a316353003ae1cb4a7
 * Retained: argv spawn, process groups, watchdog, signal/exit handling,
 * pipe drain, version probe and atomic result publication; raw byte capture replaces decoding per chunk.
 * Local additions: native JSON, contracts, audit, session binding, attempt budget.
 * Usage: node relay.mjs --contract CONTRACT.json [--state-root DIR]
 *        [--previous-run DIR] [--session-from DIR] [--model LABEL] [--effort LEVEL]
 * Never auto-replays. Never bypasses permissions. See references/runtime.md.
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, renameSync, readFileSync, existsSync, appendFileSync,
  realpathSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { constants, homedir } from 'node:os';
import { loadContract, collectEvidence, compareEvidence, inside } from './audit.mjs';
const VERSION_PROBE_TIMEOUT_MS = 10_000;
function atomicJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, path);
}
function parseArgs(argv) {
  const opts = { stateRoot: join(homedir(), '.local/state/my-agy-delegate') };
  const keys = { '--contract': 'contract', '--state-root': 'stateRoot', '--previous-run': 'previousRun',
    '--session-from': 'sessionFrom', '--model': 'model', '--effort': 'effort' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help') { process.stdout.write('Usage: node relay.mjs --contract CONTRACT.json [--state-root DIR] [--previous-run DIR] [--session-from DIR] [--model LABEL] [--effort low|medium|high]\n'); process.exit(0); }
    const key = keys[argv[i]];
    if (!key || opts[key] !== undefined && key !== 'stateRoot' || !argv[i + 1]) throw Error(`invalid or duplicate option: ${argv[i]}`);
    opts[key] = argv[++i];
  }
  if (!opts.contract) throw Error('--contract required');
  if (opts.effort && !['low', 'medium', 'high'].includes(opts.effort)) throw Error('effort must be low/medium/high');
  return opts;
}
function binding(c) {
  return { workspace: c.workspace_absolute_path, base_commit: c.base_commit, goal: c.goal,
    owned_files: c.owned_files, forbidden_files: c.forbidden_files, constraints: c.constraints,
    acceptance_criteria: c.acceptance_criteria, verification_commands: c.verification_commands,
    output_contract: c.output_contract,
    permission_profile: c.permission_profile, authorization_scope: c.authorization_scope,
    capability_review: c.capability_review, sandbox: c.sandbox };
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function prepareRunDir(opts) {
  const c = opts.c;
  // Validate before mkdir: never even create an output directory inside the repo.
  let existing = resolve(opts.stateRoot);
  while (!existsSync(existing)) existing = dirname(existing);
  if (inside(realpathSync(existing), opts.cd) || inside(resolve(opts.stateRoot), opts.cd)) throw Error('state root must be outside the business repository');
  mkdirSync(opts.stateRoot, { recursive: true, mode: 0o700 });
  opts.stateRoot = realpathSync(opts.stateRoot);
  if (inside(opts.stateRoot, opts.cd)) throw Error('state root must be outside the business repository');
  // One executor per state root. Stale locks are deliberately not adopted/deleted.
  const lock = join(opts.stateRoot, '.active');
  mkdirSync(lock, { mode: 0o700 });
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ relay_pid: process.pid, task_id: c.task_id, workspace: opts.cd }));
  let release = true;
  process.on('exit', () => { if (release) rmSync(lock, { recursive: true, force: true }); });
  const retainLock = () => { release = false; };
  const releaseLock = () => { release = true; };
  const repoId = createHash('sha256').update(opts.cd).digest('hex').slice(0, 20);
  const taskDir = join(opts.stateRoot, repoId, c.task_id);
  mkdirSync(taskDir, { recursive: true, mode: 0o700 });
  const history = readdirSync(taskDir).map(id => join(taskDir, id)).filter(dir => existsSync(join(dir, 'manifest.json')))
    .map(dir => ({ dir, manifest: readJson(join(dir, 'manifest.json')) }));
  for (const h of history) {
    if (!same(h.manifest.binding, binding(c))) throw Error('task binding changed; supervisor must replan without resetting this task budget');
    if (!existsSync(join(h.dir, 'result.json'))) throw Error(`recovery required: missing result in ${h.dir}`);
  }
  const executed = history.filter(h => h.manifest.execution_started).sort((a,b) => a.manifest.attempt_number - b.manifest.attempt_number);
  if (executed.length >= 3) throw Error('task exhausted initial + two corrective attempts');
  if (c.corrective_attempts_used !== executed.length) throw Error(`corrective_attempts_used must equal ${executed.length}`);
  const before = collectEvidence(opts.cd);
  if (before.head !== c.base_commit) throw Error('current HEAD does not match base_commit');
  if (!executed.length && !before.clean) throw Error('initial workspace must be clean; supervisor should create an isolated worktree');
  if (c.recovery !== undefined && !executed.length) throw Error('permission recovery requires a previous execution');
  if (executed.length) {
    const previous = executed.at(-1);
    if (!opts.previousRun || realpathSync(opts.previousRun) !== previous.dir) throw Error('--previous-run must identify the latest execution attempt');
    const result = readJson(join(previous.dir, 'result.json'));
    if (c.recovery !== undefined) {
      const recovery = c.recovery;
      if (!recovery || Array.isArray(recovery) || typeof recovery !== 'object' ||
          previous.manifest.task_id !== c.task_id || result.task_id !== c.task_id ||
          previous.manifest.execution_started !== true ||
          result.attempt_id !== previous.manifest.attempt_id ||
          recovery.from_attempt_id !== previous.manifest.attempt_id ||
          recovery.reason !== 'permission_blocked' || result.execution_status !== 'permission_blocked' ||
          result.retry_blocker !== true || result.process_terminated !== true || result.audit_scope !== 'scope clean' ||
          recovery.authorization !== 'explicit-user-approval' ||
          typeof recovery.change !== 'string' || !recovery.change.trim()) {
        throw Error('permission recovery requires the latest stopped, scope-clean permission_blocked attempt, explicit user authorization and an external permission change');
      }
      if (c.conversation_id !== null || opts.sessionFrom) throw Error('permission recovery requires a new conversation');
    } else if (!result.process_terminated || result.retry_blocker) {
      throw Error(`previous run requires supervisor recovery: ${result.execution_status}`);
    }
    if (readJson(join(previous.dir, 'after.json')).fingerprint !== before.fingerprint) throw Error('Git state differs from previous after evidence; audit/replan first');
    for (const key of ['observed_failure', 'evidence', 'expected_behavior', 'rerun_command']) {
      if (typeof c.correction?.[key] !== 'string' || !c.correction[key].trim()) throw Error(`correction.${key} required`);
    }
    if (c.correction.evidence === previous.manifest.contract.correction?.evidence) throw Error('correction needs new evidence');
    if (result.execution_status !== 'execution_completed' &&
        (c.correction.process_confirmed_stopped !== true || c.correction.external_side_effects_clear !== true)) throw Error('abnormal-result correction requires process and side-effect review');
  } else if (opts.previousRun) throw Error('no previous execution for this task');
  if (c.conversation_id !== null) {
    const from = opts.sessionFrom || opts.previousRun;
    if (!from) throw Error('explicit conversation requires --session-from or --previous-run');
    const manifest = readJson(join(from, 'manifest.json')); const result = readJson(join(from, 'result.json'));
    if (!same(manifest.binding, binding(c)) || result.conversation_id !== c.conversation_id ||
        !result.conversation_trusted || !result.process_terminated ||
        readJson(join(from, 'after.json')).fingerprint !== before.fingerprint) throw Error('conversation binding/state mismatch; use null for a fresh conversation after audit');
  } else if (opts.sessionFrom) throw Error('--session-from requires explicit conversation_id');
  const dir = join(taskDir, c.attempt_id);
  mkdirSync(dir, { mode: 0o700 }); // exclusive: never reuse an artifact directory
  const run = { dir, retainLock, releaseLock, startedAt: new Date().toISOString(), finalPath: join(dir, 'stdout.json'),
    logPath: join(dir, 'agy.log'), stderrPath: join(dir, 'stderr.log'), resultPath: join(dir, 'result.json'),
    manifestPath: join(dir, 'manifest.json'), before };
  run.manifest = { schema: 'my-agy.manifest.v1', task_id: c.task_id, attempt_id: c.attempt_id,
    binding: binding(c), conversation_id: c.conversation_id, contract: c, before,
    attempt_number: executed.length + 1, corrective_attempts_used: c.corrective_attempts_used,
    execution_started: false, started_at: run.startedAt, model: opts.model ?? null, effort: opts.effort ?? null };
  atomicJson(run.manifestPath, run.manifest);
  atomicJson(join(dir, 'before.json'), before);
  writeFileSync(join(dir, 'contract.md'), '# Task Contract\n\n```json\n' + JSON.stringify(c, null, 2) + '\n```\n', { mode: 0o600 });
  for (const path of [run.finalPath, run.stderrPath, join(dir, 'verification.log')]) writeFileSync(path, '', { mode: 0o600 });
  return run;
}
function buildArgv(opts, brief, run) {
  const argv = opts.c.conversation_id ? ['--conversation', opts.c.conversation_id] : ['--new-project', '--add-dir', opts.cd];
  if (opts.model) argv.push('--model', opts.model);
  if (opts.effort) argv.push('--effort', opts.effort);
  if (opts.c.sandbox) argv.push('--sandbox');
  argv.push('--output-format', 'json', '--print-timeout', `${opts.c.timeout}s`, '--log-file', run.logPath, `--print=${brief}`);
  return argv;
}
function nativeResult(raw, stderr, requestedId) {
  let envelope = null; let status = 'execution_completed';
  if (!raw.trim()) status = 'empty_output';
  else { try { envelope = JSON.parse(raw); } catch { status = 'malformed_json'; } }
  if (envelope !== null && (!envelope || Array.isArray(envelope) || typeof envelope !== 'object' ||
      typeof envelope.status !== 'string' || typeof envelope.response !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(envelope.conversation_id || ''))) status = 'unsupported_protocol';
  if (envelope === null && raw.trim() === 'null') status = 'unsupported_protocol';
  const diagnostic = stderr + '\n' + (typeof envelope?.error === 'string' ? envelope.error : '');
  if (status === 'execution_completed') {
    if (requestedId && envelope.conversation_id !== requestedId) status = 'conversation_mismatch';
    else if (envelope.status !== 'SUCCESS' || envelope.error) status = 'native_failed';
    else if (!envelope.response.trim()) status = 'empty_output';
  }
  // Fail closed on diagnostic notices, including exit-zero headless soft denials.
  if (/permission.{0,100}(denied|required|cannot|ask)|auto[- ]denied|soft[- ]denied|requires? approval|not allowed/i.test(diagnostic)) status = 'permission_blocked';
  else if (/authentication (required|failed|expired)|unauthenticated|login required|please (log in|login)|invalid.token|invalid_grant/i.test(diagnostic)) status = 'authentication_blocked';
  else if (/quota.{0,60}(exceed|exhaust|insufficient|limit|unavailable)|rate.limit|resource.exhausted|credits?.{0,40}(exhausted|insufficient)/i.test(diagnostic)) status = 'quota_blocked';
  else if (/network (error|unreachable|is unreachable|failure|uncertainty)|connection (reset|refused|failed)|dial tcp|unexpected EOF|proxy.*error|broken pipe/i.test(diagnostic)) status = 'network_uncertainty';
  else if (/unknown (flag|option)|unrecognized (flag|option)|unsupported.*(format|json)/i.test(diagnostic)) status = 'unsupported_protocol';
  else if (/timed? ?out|timeout.{0,40}(expired|reached|exceeded)|deadline.{0,30}(expired|exceeded)|partial output|truncat|terminating.*background task/i.test(diagnostic)) status = 'partial_output';
  return { envelope, status };
}
function makeResultWriter(opts, version, run) {
  return extra => {
    const raw = readFileSync(run.finalPath, 'utf8');
    const stderr = readFileSync(run.stderrPath, 'utf8');
    const parsed = nativeResult(raw, stderr, opts.c.conversation_id);
    let executionStatus = ['timeout', 'aborted', 'failed', 'agy_unavailable', 'unsupported_protocol'].includes(extra.status) ? extra.status : parsed.status;
    let audit;
    try {
      const after = collectEvidence(opts.cd); atomicJson(join(run.dir, 'after.json'), after);
      audit = compareEvidence(opts.c, run.before, after);
    } catch (e) { audit = { scope: 'evidence unavailable', error: e.message }; }
    atomicJson(join(run.dir, 'audit.json'), audit);
    if (extra.status === 'failed' && ['permission_blocked','authentication_blocked','quota_blocked','network_uncertainty','unsupported_protocol'].includes(parsed.status)) executionStatus = parsed.status;
    if (executionStatus === 'execution_completed' && audit.scope !== 'scope clean') executionStatus = audit.scope === 'scope violation' ? 'scope_violation' : 'audit_failed';
    const terminated = !run.child?.pid || (run.child.exitCode !== null || run.child.signalCode !== null) && !ownedGroupAlive(run.child.pid);
    if (!terminated) executionStatus = 'process_unknown';
    if (terminated) run.releaseLock();
    const blocked = ['permission_blocked','authentication_blocked','quota_blocked','network_uncertainty','unsupported_protocol','conversation_mismatch','scope_violation','audit_failed','process_unknown'];
    const result = { schema: 'my-agy.execution.v1', task_id: opts.c.task_id, attempt_id: opts.c.attempt_id,
      execution_status: executionStatus, acceptance: 'pending_supervisor_verification',
      process_exit_code: run.child?.exitCode ?? null, signal: run.child?.signalCode ?? null,
      relay_signal: extra.signal ?? null,
      process_terminated: terminated, retry_blocker: blocked.includes(executionStatus) || audit.scope !== 'scope clean',
      conversation_id: parsed.envelope?.conversation_id ?? null,
      conversation_trusted: !!parsed.envelope && !['malformed_json','unsupported_protocol','conversation_mismatch'].includes(parsed.status),
      native_status: parsed.envelope?.status ?? null, cli_envelope: parsed.envelope,
      agent_report: typeof parsed.envelope?.response === 'string' ? parsed.envelope.response : '',
      agy_version: version, started_at: run.startedAt, finished_at: new Date().toISOString(),
      audit_scope: audit.scope, artifacts: run.dir,
      stderr_tail: stderr.split('\n').filter(Boolean).slice(-20), error: extra.error ?? null,
      exitCode: executionStatus === 'execution_completed' ? 0 : extra.exitCode || 1 };
    run.manifest.conversation_id = result.conversation_trusted ? result.conversation_id : null;
    run.manifest.execution_status = executionStatus;
    run.manifest.finished_at = result.finished_at;
    atomicJson(run.manifestPath, run.manifest);
    atomicJson(run.resultPath, result);
    return result;
  };
}
function ownedGroupAlive(pid) {
  // POSIX only: a descendant can keep writing after its parent exits. Never adopt a stored PID.
  try { process.kill(-pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; }
}
function killChild(child, signal = "SIGTERM") {
  if (!child || !child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process group already exited.
    }
  }
}

function agyVersion(timeoutMs) {
  try {
    const out = execFileSync("agy", ["changelog"], {
      encoding: "utf8",
      timeout: Math.min(timeoutMs, VERSION_PROBE_TIMEOUT_MS),
      killSignal: "SIGKILL",
    }).trim();
    const firstLine = out.split("\n").find(Boolean) || "";
    const match = firstLine.match(/^([^:\s]+):/);
    return match ? match[1] : firstLine || null;
  } catch (err) {
    // Only a missing binary means "unavailable"; any other changelog failure
    // (permissions, a broken subcommand) must not masquerade as exit 127.
    if (err && err.code === "ENOENT") return null;
    if (err && err.code === "ETIMEDOUT") throw err;
    return "unknown";
  }
}

function dispatchToAgy(opts, brief, run, writeResult, watchdogMs) {
  const argv = buildArgv(opts, brief, run);
  // Antigravity's installer provides a native `agy` binary. Launch directly so
  // multi-line briefs and paths with spaces are passed as argv, not shell text.
  const child = spawn("agy", argv, {
    cwd: opts.cd,
    env: { ...process.env, PWD: opts.cd },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // POSIX: lead a new process group so killChild can fell the whole tree
  });

  run.child = child;
  run.manifest.child_pid = child.pid ?? null;
  atomicJson(run.manifestPath, run.manifest);
  let settled = false;
  let watchdogFired = false;
  let sigkillTimer = null;
  const terminate = () => {
    child.once("exit", () => {
      child.stdout.destroy();
      child.stderr.destroy();
    });
    killChild(child);
    sigkillTimer = setTimeout(() => {
      if (!settled) killChild(child, "SIGKILL");
    }, 10_000);
  };
  const watchdogTimer = setTimeout(() => {
    watchdogFired = true;
    terminate();
  }, watchdogMs);

  // The relay's own death must still produce a result: without this, a kill from the
  // orchestrator's side (its command timeout, a stopped task, a closed terminal) writes
  // no result.json and leaves the agy child running or dying mid-edit with nothing
  // recording why. Uncatchable SIGKILL instead leaves raw evidence and the execution lock.
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.on(sig, () => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdogTimer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      const abortedFields = {
        status: "aborted",
        exitCode: 128 + (constants.signals[sig] || 15),
        signal: sig,
        error: `the relay was killed by ${sig}; agy was terminated with it — inspect the working tree before re-dispatching`,
      };
      let finalized = false;
      const finalizeAbort = () => {
        if (finalized) return;
        finalized = true;
        killChild(child, "SIGKILL");
        if (sigkillTimer) clearTimeout(sigkillTimer);
        const result = writeResult(abortedFields);
        printSummary(result, run.resultPath);
        process.exit(result.exitCode);
      };
      child.once("close", finalizeAbort);
      killChild(child);
      sigkillTimer = setTimeout(() => {
        killChild(child, "SIGKILL");
      }, 2000);
    });
  }

  // Preserve exact bytes incrementally. Decode once at result time, so UTF-8 split
  // between pipe chunks is never independently decoded or re-encoded.
  child.stdout.on("data", chunk => appendFileSync(run.finalPath, chunk));
  child.stderr.on("data", chunk => appendFileSync(run.stderrPath, chunk));

  // A grandchild that outlives agy and inherited the pipes keeps stdout/stderr open, so
  // "close" never fires and the relay waits forever, writing no result. Once agy itself is
  // gone the pipes hold nothing we still need, so drop them after a short drain grace and let
  // "close" run. This is the normal-exit twin of the stream teardown the watchdog already
  // does on the timeout path.
  child.once("exit", () => {
    // The implementer already exited. Leaving the watchdog armed lets a drain that
    // overlaps the remaining budget fire, set watchdogFired, and report timeout.
    if (!watchdogFired) {
      clearTimeout(watchdogTimer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
    }
    const drain = setTimeout(() => {
      if (settled) return;
      child.stdout.destroy();
      child.stderr.destroy();
    }, 500);
    if (typeof drain.unref === "function") drain.unref();
  });

  child.on("error", (err) => {
    if (settled) return;
    settled = true;
    clearTimeout(watchdogTimer);
    if (sigkillTimer) clearTimeout(sigkillTimer);
    const result = writeResult({
      status: "failed",
      exitCode: 1,
      signal: null,
      error: String(err && err.message ? err.message : err),
    });
    printSummary(result, run.resultPath);
    process.exit(1);
  });

  child.on("close", (code, signal) => {
    if (settled) return;
    settled = true;
    clearTimeout(watchdogTimer);
    if (sigkillTimer) clearTimeout(sigkillTimer);
    // a descendant that ignored SIGTERM must not outlive the timeout report: once the
    // parent is down, sweep our owned process group.
    const killedByRelay = watchdogFired;
    if (killedByRelay) killChild(child, "SIGKILL");
    const mapped = code ?? (constants.signals[signal] ? 128 + constants.signals[signal] : 1);
    const result = writeResult({
      status: killedByRelay ? "timeout" : code === 0 ? "completed" : "failed",
      exitCode: killedByRelay ? 124 : mapped,
      signal: signal ?? null,
      ...(killedByRelay ? { error: "relay watchdog expired; inspect partial modifications" } : {}),
    });
    printSummary(result, run.resultPath);
    process.exit(result.exitCode);
  });
}


function printSummary(result, resultPath) {
  process.stdout.write(JSON.stringify({ execution_status: result.execution_status, acceptance: result.acceptance,
    conversation_id: result.conversation_id, audit_scope: result.audit_scope, result: resultPath }) + '\n');
}
function main() {
  if (process.platform === 'win32') throw Error('v1 POSIX lifecycle only; Windows is not validated');
  const opts = parseArgs(process.argv.slice(2));
  opts.c = loadContract(opts.contract); opts.cd = opts.c.workspace_absolute_path;
  const brief = 'Act as the bounded implementation executor. Read applicable AGENTS.md. Follow this contract; do not commit, push, install dependencies, write outside scope, escalate permissions, or perform external account actions. Run verification synchronously and finish only after it completes. Report concise reasoning, modified files, validation actually run, unresolved issues and blockers. Do not provide private chain-of-thought.\n' + JSON.stringify(opts.c, null, 2);
  if (Buffer.byteLength(brief, 'utf8') > 120 * 1024) throw Error('contract prompt exceeds argv byte limit (120 KiB)');
  const run = prepareRunDir(opts);
  let version;
  try { version = agyVersion(VERSION_PROBE_TIMEOUT_MS); }
  catch (e) {
    const result = makeResultWriter(opts, 'unknown', run)({ status: 'timeout', exitCode: 124, error: `version probe failed: ${e.message}` });
    printSummary(result, run.resultPath); process.exit(result.exitCode);
  }
  const writeResult = makeResultWriter(opts, version, run);
  if (!version) {
    const result = writeResult({ status: 'agy_unavailable', exitCode: 127, error: 'agy not on PATH; no execution dispatched' });
    printSummary(result, run.resultPath); process.exit(127);
  }
  // Capability check runs no agent prompt. Unsupported versions fail before dispatch.
  let preflightFailure = 'unsupported_protocol';
  try {
    const probe = spawnSync('agy', ['--help'], {
      encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const reason = probe.error ? (probe.error.code === 'ETIMEDOUT' ? 'timeout' : 'spawn_failure')
      : probe.signal ? 'signal' : probe.status === 0 ? 'exited' : 'nonzero_exit';
    atomicJson(join(run.dir, 'preflight.json'), {
      command: ['agy', '--help'], exit_status: probe.status, signal: probe.signal,
      termination_reason: reason,
      error: probe.error ? { code: probe.error.code, message: probe.error.message } : null,
      stdout: probe.stdout ?? '', stderr: probe.stderr ?? '',
    });
    if (probe.error || probe.signal || probe.status !== 0) {
      preflightFailure = reason === 'timeout' ? 'timeout' : 'failed';
      throw Error(`${reason}: ${probe.error?.code ?? probe.signal ?? probe.status}`);
    }
    const help = (probe.stdout ?? '') + '\n' + (probe.stderr ?? '');
    for (const flag of ['--output-format', '--conversation', '--new-project', '--add-dir', '--print-timeout', '--log-file', '--print', ...(opts.c.sandbox ? ['--sandbox'] : [])]) {
      if (!help.includes(flag)) throw Error(`missing ${flag}`);
    }
  } catch (e) {
    const result = writeResult({ status: preflightFailure, exitCode: 2, error: `capability preflight failed: ${e.message}` });
    printSummary(result, run.resultPath); process.exit(result.exitCode);
  }
  run.manifest.agy_version = version;
  if (collectEvidence(opts.cd).fingerprint !== run.before.fingerprint) {
    const result = writeResult({ status: 'failed', exitCode: 2, error: 'workspace changed during preflight; no execution dispatched' });
    printSummary(result, run.resultPath); process.exit(result.exitCode);
  }
  run.manifest.execution_started = true; // reserve before spawn: crashes here require recovery, not replay
  atomicJson(run.manifestPath, run.manifest);
  run.retainLock();
  dispatchToAgy(opts, brief, run, writeResult, opts.c.timeout * 1000 + 60_000);
}
try { main(); } catch (e) { process.stderr.write(`relay: ${e.message}\n`); process.exitCode = 2; }
