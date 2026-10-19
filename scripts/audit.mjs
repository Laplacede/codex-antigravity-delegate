#!/usr/bin/env node
// Deterministic evidence only. No checkout/reset/clean/commit or verification execution.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function git(cwd, args) {
  return execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], {
    cwd, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString('utf8');
}
export function inside(path, root) {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../'));
}
function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw Error(`${name} must be a nonempty string`);
}
function validatePaths(paths, name) {
  if (!Array.isArray(paths)) throw Error(`${name} must be an array`);
  for (const item of paths) {
    if (!item || !['file', 'directory'].includes(item.kind) || typeof item.path !== 'string' ||
        !item.path || item.path.includes('\\') || /[\x00-\x1f*?\[\]]/.test(item.path) ||
        isAbsolute(item.path) || /^[A-Za-z]:/.test(item.path) ||
        item.path.split('/').some(part => !part || part === '.' || part === '..') ||
        item.path.split('/').includes('.git')) throw Error(`${name}: use canonical relative literal paths and file/directory kinds`);
  }
}
export function loadContract(path) {
  const c = JSON.parse(readFileSync(path, 'utf8'));
  if (c.schema !== 'my-agy.contract.v1') throw Error('unsupported contract schema');
  for (const key of ['task_id', 'attempt_id']) {
    if (typeof c[key] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(c[key])) throw Error(`invalid ${key}`);
  }
  for (const key of ['goal', 'context']) requiredString(c[key], key);
  if (!isAbsolute(c.workspace_absolute_path || '')) throw Error('workspace_absolute_path must be absolute');
  c.workspace_absolute_path = realpathSync(c.workspace_absolute_path);
  if (!/^[a-f0-9]{40,64}$/.test(c.base_commit || '')) throw Error('base_commit must be a full commit id');
  if (c.conversation_id !== null && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(c.conversation_id || '')) throw Error('invalid conversation_id; use null for a fresh conversation');
  if (typeof c.sandbox !== 'boolean') throw Error('sandbox must be an explicit boolean (terminal restriction, not a read-only claim)');
  if (!Number.isInteger(c.timeout) || c.timeout < 1 || c.timeout > 2_147_423) throw Error('timeout must be seconds in 1..2147423');
  validatePaths(c.owned_files?.paths, 'owned_files.paths');
  validatePaths(c.forbidden_files, 'forbidden_files');
  for (const key of ['no_commit', 'no_push', 'no_dependency_install', 'no_external_writes', 'no_permission_escalation']) {
    if (c.constraints?.[key] !== true) throw Error(`constraints.${key} must be true`);
  }
  for (const key of ['acceptance_criteria', 'output_contract']) {
    if (!Array.isArray(c[key]) || !c[key].length) throw Error(`${key} must be a nonempty array`);
    c[key].forEach(v => requiredString(v, key));
  }
  if (!Array.isArray(c.verification_commands) || !c.verification_commands.length) throw Error('verification_commands required');
  for (const v of c.verification_commands) {
    requiredString(v.cwd, 'verification cwd'); requiredString(v.command, 'verification command'); requiredString(v.expected, 'verification expected');
    if (!isAbsolute(v.cwd) || !inside(realpathSync(v.cwd), c.workspace_absolute_path)) throw Error('verification cwd must be within workspace');
  }
  return c;
}
function names(raw) { return raw.split('\0').filter(Boolean); }
function nameStatus(raw) {
  const tokens = raw.split('\0'); const rows = [];
  for (let i = 0; i < tokens.length && tokens[i];) {
    const status = tokens[i++]; const path = tokens[i++];
    rows.push(status[0] === 'R' || status[0] === 'C' ? { status, from: path, path: tokens[i++] } : { status, path });
  }
  return rows;
}
export function collectEvidence(workspace) {
  workspace = realpathSync(workspace);
  const root = realpathSync(git(workspace, ['rev-parse', '--show-toplevel']).trim());
  if (workspace !== root) throw Error('workspace must be the repository root');
  const head = git(root, ['rev-parse', '--verify', 'HEAD']).trim();
  const branch = git(root, ['branch', '--show-current']).trim();
  const diff = ['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '--find-renames'];
  const staged = nameStatus(git(root, [...diff, '--cached']));
  const unstaged = nameStatus(git(root, diff));
  const tracked = names(git(root, ['ls-files', '-z']));
  const indexFingerprint = createHash('sha256').update(git(root, ['ls-files', '--stage', '-z'])).digest('hex');
  const untracked = names(git(root, ['ls-files', '--others', '--exclude-standard', '-z']));
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  // Hash contents too: a second edit to an already dirty file need not change porcelain.
  const hash = createHash('sha256').update(JSON.stringify({ head, branch, status, staged, unstaged, indexFingerprint }));
  for (const path of [...new Set([...tracked, ...untracked])].sort()) {
    hash.update('\0' + path + '\0');
    try {
      const st = lstatSync(join(root, path)); hash.update(String(st.mode));
      if (st.isSymbolicLink()) hash.update(readlinkSync(join(root, path)));
      else if (st.isFile()) hash.update(readFileSync(join(root, path)));
      else throw Error(`unsupported nested repository/directory: ${path}`);
    } catch (e) { if (e.code === 'ENOENT') hash.update('missing'); else throw e; }
  }
  return { schema: 'my-agy.git.v1', workspace, branch, head, staged, unstaged,
    untracked, clean: !status, fingerprint: hash.digest('hex') };
}
function matches(path, entries) {
  return entries.some(e => path === e.path || (e.kind === 'directory' && path.startsWith(e.path + '/')));
}
function symlinkAncestor(path, root) {
  let current = dirname(join(root, path));
  while (current !== root && inside(current, root)) {
    try { if (lstatSync(current).isSymbolicLink()) return true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    current = dirname(current);
  }
  return false;
}
export function compareEvidence(c, before, after) {
  const violations = [];
  const observations = [];
  if (before.workspace !== after.workspace || after.workspace !== c.workspace_absolute_path) violations.push('workspace_changed');
  if (before.head !== after.head || after.head !== c.base_commit) violations.push('unexpected_HEAD_change');
  if (before.branch !== after.branch) violations.push('unexpected_branch_change');
  const committed = nameStatus(git(after.workspace, ['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '-M', c.base_commit, 'HEAD']));
  const changes = [...before.staged, ...before.unstaged, ...after.staged, ...after.unstaged, ...committed,
    ...before.untracked.map(path => ({ status: '?', path })), ...after.untracked.map(path => ({ status: '?', path }))];
  const paths = [...new Set(changes.flatMap(e => [e.path, e.from].filter(Boolean)))];
  const basePaths = new Set(names(git(after.workspace, ['ls-tree', '-r', '--name-only', '-z', c.base_commit])));
  const additions = paths.filter(path => !basePaths.has(path));
  for (const path of paths) {
    if (matches(path, c.forbidden_files)) violations.push(`forbidden:${path}`);
    if (!matches(path, c.owned_files.paths)) observations.push(`additional_path:${path}`);
    if (symlinkAncestor(path, after.workspace)) violations.push(`symlink_ancestor:${path}`);
  }
  return { schema: 'my-agy.audit.v1', scope: violations.length ? 'scope violation' : 'scope clean',
    violations: [...new Set(violations)], observations, changed_paths: paths,
    expected_paths: paths.filter(path => matches(path, c.owned_files.paths)), additions,
    deletions: changes.filter(e => e.status[0] === 'D'), renames: changes.filter(e => e.status[0] === 'R'),
    committed };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, contractPath, beforePath] = process.argv.slice(2);
    if (!['before', 'after'].includes(mode) || !contractPath || (mode === 'after' && !beforePath)) throw Error('usage: node audit.mjs before CONTRACT.json | after CONTRACT.json MANIFEST.json');
    const c = loadContract(contractPath); const current = collectEvidence(c.workspace_absolute_path);
    const result = mode === 'before' ? current : compareEvidence(c, JSON.parse(readFileSync(beforePath, 'utf8')).before, current);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.scope === 'scope violation') process.exitCode = 1;
  } catch (e) { process.stderr.write(`audit: evidence unavailable: ${e.message}\n`); process.exitCode = 2; }
}
