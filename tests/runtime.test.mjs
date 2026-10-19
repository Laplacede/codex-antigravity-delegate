// Development-only. Fake executable + real disposable Git repos; never runs installed AGY.
// Process scenarios adapted from upstream test/relay/agy.mjs, abort.mjs,
// timeout-tree.mjs, orphan-stdio.mjs (MIT; see ../LICENSE and runtime.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract, collectEvidence, compareEvidence } from '../scripts/audit.mjs';

const skill = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const relay = join(skill, 'scripts/relay.mjs');
const fakeSource = `#!/usr/bin/env node
const fs = require('node:fs'); const cp = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === 'changelog') { if (process.env.FAKE_MODE === 'help-spawn-failure') fs.unlinkSync(process.argv[1]); console.log('fixture-1.4.1:'); process.exit(0); }
if (args[0] === '--help') {
  fs.appendFileSync(process.env.FAKE_HELP_CALLS, JSON.stringify(args) + '\\n');
  const help = process.env.FAKE_MODE === 'old' ? '--print' : '--output-format json --conversation --new-project --add-dir --print-timeout --log-file --sandbox --print';
  if (process.env.FAKE_MODE === 'help-timeout') {
    process.stdout.write('partial help stdout'); process.stderr.write('partial help stderr'); setInterval(()=>{},1000); return;
  }
  if (process.env.FAKE_MODE === 'help-stderr') process.stderr.write(help);
  else if (process.env.FAKE_MODE === 'help-split') { process.stdout.write('--output-format json --conversation'); process.stderr.write('--new-project --add-dir --print-timeout --log-file --sandbox --print'); }
  else console.log(help);
  process.exit(process.env.FAKE_MODE === 'help-nonzero' ? 7 : 0);
}
fs.appendFileSync(process.env.FAKE_CALLS, JSON.stringify(args) + '\\n');
const c = JSON.parse(args.find(a => a.startsWith('--print=')).slice(args.find(a => a.startsWith('--print=')).indexOf('\\n') + 1));
const mode = process.env.FAKE_MODE || 'ok';
if (mode.includes('edit') || mode.startsWith('hang')) fs.writeFileSync('src/main.js', 'module.exports = 2;\\n');
if (mode === 'loop') {
  fs.writeFileSync('src/main.js','module.exports = ;');
  const red = cp.spawnSync(process.execPath,['--check','src/main.js']);
  fs.writeFileSync('src/main.js','module.exports = 2;');
  const green = cp.spawnSync(process.execPath,['--check','src/main.js']);
  fs.writeFileSync('tests/experiment.json',JSON.stringify({red:red.status,green:green.status}));
}
if (mode === 'scope') fs.writeFileSync('other.txt', 'out of scope');
if (mode === 'commit') { fs.writeFileSync('src/main.js','changed'); cp.execFileSync('git',['add','src/main.js']); cp.execFileSync('git',['commit','-qm','unexpected']); }
if (mode.startsWith('hang')) { if (mode === 'hang-resistant') process.on('SIGTERM',()=>{}); process.stdout.write('{"partial":"保留'); process.stderr.write('still working\\n'); setInterval(() => {}, 1000); }
else if (mode === 'orphan') { cp.spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{stdio:'inherit'}).unref(); console.log(JSON.stringify({conversation_id:'conv-001',status:'SUCCESS',response:'done'})); }
else if (mode === 'empty') {}
else if (mode === 'bad-edit') process.stdout.write('{broken json');
else {
  if (mode === 'permission') process.stderr.write('command permission required; auto-denied in headless mode\\n');
  if (mode === 'timeout-edit') process.stderr.write('print timeout reached; returning partial output\\n');
  if (mode === 'network') process.stderr.write('connection reset; network uncertainty\\n');
  if (mode === 'auth') process.stderr.write('authentication required\\n');
  if (mode === 'quota') process.stderr.write('quota exhausted\\n');
  if (mode === 'old-response') console.log('old text-only implementation');
  else if (mode === 'wrong-shape') console.log(JSON.stringify({result:{status:'SUCCESS'}}));
  else {
    const obj = {conversation_id:mode === 'mismatch' ? 'other-conversation' : c.conversation_id || 'conv-001',status:mode === 'native-error' ? 'ERROR' : 'SUCCESS',response:mode === 'empty-response' ? '' : '已完成：root cause, modified files, validations, unresolved issues, no blockers. permission denied is quoted report text only.'};
    const bytes=Buffer.from(JSON.stringify(obj)); let i=bytes.indexOf(Buffer.from('已'))+1;
    process.stdout.write(bytes.subarray(0,i)); setTimeout(()=>process.stdout.write(bytes.subarray(i)),5);
    if (mode === 'exit-seven') process.exitCode = 7;
  }
}
`;
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'my-agy-test-'));
  t.after(() => { if (!process.env.MY_AGY_KEEP_TEST_FIXTURES) rmSync(root, { recursive: true, force: true }); });
  const repo = join(root, 'repo with spaces'); const bin = join(root, 'bin'); const state = join(root, 'state');
  mkdirSync(repo); mkdirSync(bin); mkdirSync(join(repo, 'src')); mkdirSync(join(repo, 'tests'));
  // No ambient PATH fallback: a missing fake AGY must never select an installed CLI.
  symlinkSync(process.execPath,join(bin,'node'));
  symlinkSync(execFileSync('/usr/bin/which',['git'],{encoding:'utf8'}).trim(),join(bin,'git'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
  git('init','-q'); git('config','user.name','Fixture'); git('config','user.email','fixture@example.invalid');
  writeFileSync(join(repo,'src/main.js'),'module.exports = 1;\n');
  writeFileSync(join(repo,'tests/check.js'),'original test\n');
  writeFileSync(join(repo,'.gitignore'),'ignored/\n');
  git('add','.'); git('commit','-qm','baseline');
  writeFileSync(join(bin,'agy'),fakeSource); chmodSync(join(bin,'agy'),0o755);
  const calls = join(root, 'calls.jsonl');
  const helpCalls = join(root, 'help-calls.jsonl');
  const c = { schema:'my-agy.contract.v1', task_id:'task', attempt_id:'a0', workspace_absolute_path:repo,
    base_commit:git('rev-parse','HEAD'), conversation_id:null, sandbox:false,
    timeout:5, goal:'Fix module',context:'Disposable fixture',
    owned_files:{paths:[{path:'src',kind:'directory'},{path:'tests',kind:'directory'}],allow_new_files:true},
    forbidden_files:[{path:'tests/check.js',kind:'file'}],
    constraints:{no_commit:true,no_push:true,no_dependency_install:true,no_external_writes:true,no_permission_escalation:true},
    acceptance_criteria:['Correct module'],verification_commands:[{cwd:repo,command:'node --check src/main.js',expected:'exit 0'}],
    output_contract:['Root cause; files; validation actually run; unresolved issues; blocker'] };
  const contract = join(root,'contract.json');
  const env = mode => ({ ...process.env, PATH:bin, FAKE_MODE:mode, FAKE_CALLS:calls, FAKE_HELP_CALLS:helpCalls });
  const args = extra => [relay,'--contract',contract,'--state-root',state,...extra];
  const run = (mode='ok', extra=[]) => {
    writeFileSync(contract,JSON.stringify(c));
    const p = spawnSync(process.execPath,args(extra),{env:env(mode),encoding:'utf8',timeout:20_000});
    assert.equal(p.error,undefined);
    let summary; try { summary = JSON.parse(p.stdout.trim()); } catch {}
    return { ...p, summary, result:summary ? JSON.parse(readFileSync(summary.result,'utf8')) : null,
      dir:summary ? dirname(summary.result) : null };
  };
  const count = () => existsSync(calls) ? readFileSync(calls,'utf8').trim().split('\n').length : 0;
  const next = (id, previous) => {
    c.attempt_id=id; c.conversation_id=previous.result.native_result?.conversation_id ?? null;
    c.continuation={previous_result:'Previous stage report',evidence:'Supervisor reviewed current code and experiment records',next_objective:'Continue the same engineering goal'};
  };
  return {root,repo,bin,state,git,c,contract,env,args,run,count,next,helpCalls};
}

test('help on stderr exits zero: capability passes, raw diagnostic saved, one help and one execution', t=>{
  const f=fixture(t);const p=f.run('help-stderr');assert.equal(p.status,0,p.stderr);
  const probe=JSON.parse(readFileSync(join(p.dir,'preflight.json'),'utf8'));
  assert.deepEqual(probe.command,['agy','--help']);assert.equal(probe.exit_status,0);
  assert.equal(probe.termination_reason,'exited');assert.equal(probe.stdout,'');
  assert.equal(probe.stderr,'--output-format json --conversation --new-project --add-dir --print-timeout --log-file --sandbox --print');
  assert.equal(p.result.execution_status,'execution_completed');assert.equal(f.count(),1);
  assert.equal(readFileSync(f.helpCalls,'utf8').trim().split('\n').length,1);
});
test('help capability detection combines stdout and stderr', t=>{
  const f=fixture(t);const p=f.run('help-split');assert.equal(p.status,0,p.stderr);
  const probe=JSON.parse(readFileSync(join(p.dir,'preflight.json'),'utf8'));
  assert.match(probe.stdout,/--output-format/);assert.match(probe.stderr,/--new-project/);assert.equal(f.count(),1);
  assert.equal(readFileSync(f.helpCalls,'utf8').trim().split('\n').length,1);
});
for (const [mode,reason,status] of [['help-nonzero','nonzero_exit','failed'],['help-timeout','timeout','timeout'],['help-spawn-failure','spawn_failure','failed']]) {
  test(`${mode}: diagnostic preserves termination reason; no agent execution or retry`,t=>{
    const f=fixture(t);const p=f.run(mode);assert.notEqual(p.status,0);
    const probe=JSON.parse(readFileSync(join(p.dir,'preflight.json'),'utf8'));
    assert.equal(probe.termination_reason,reason);assert.equal(p.result.execution_status,status);assert.equal(f.count(),0);
    assert.equal(JSON.parse(readFileSync(join(p.dir,'manifest.json'),'utf8')).execution_started,false);
    if (reason==='nonzero_exit') { assert.equal(probe.exit_status,7);assert.match(probe.stdout,/--output-format/); }
    else if (reason==='timeout') { assert.equal(probe.error.code,'ETIMEDOUT');assert.equal(probe.signal,'SIGKILL');assert.equal(probe.stdout,'partial help stdout');assert.equal(probe.stderr,'partial help stderr'); }
    else { assert.equal(probe.error.code,'ENOENT');assert.equal(probe.exit_status,null); }
    assert.equal(existsSync(f.helpCalls)?readFileSync(f.helpCalls,'utf8').trim().split('\n').length:0,reason==='spawn_failure'?0:1);
  });
}

test('native JSON, UTF-8, argv, private persistent artifacts; execution never accepts', t => {
  const f=fixture(t); const p=f.run('ok-edit'); assert.equal(p.status,0,p.stderr);
  assert.equal(p.result.execution_status,'execution_completed');
  assert(!('acceptance' in p.result));
  assert.match(p.result.native_result.response,/已完成/); assert.equal(p.result.native_result.status,'SUCCESS');
  assert.equal(f.count(),1);
  const args=JSON.parse(readFileSync(join(f.root,'calls.jsonl'),'utf8').trim());
  assert(args.includes('--output-format')); assert(args.includes(realpathSync(f.repo)));
  assert(!args.includes('--dangerously-skip-permissions')); assert(!args.includes('--continue'));
  assert(JSON.parse(readFileSync(join(p.dir,'manifest.json'))).before.fingerprint);
  assert(p.result.after.fingerprint);assert.equal(p.result.audit.scope,'scope clean');
  assert.equal(readFileSync(join(p.dir,'verification.log'),'utf8'),'');
});
for (const [mode,status] of [['bad-edit','malformed_json'],['empty','empty_output'],['empty-response','empty_output'],['permission','permission_blocked'],['timeout-edit','partial_output'],['network','network_uncertainty'],['auth','authentication_blocked'],['quota','quota_blocked'],['wrong-shape','unsupported_protocol'],['native-error','native_failed'],['old-response','malformed_json'],['exit-seven','failed']]) {
  test(`${mode}: fails with raw artifacts and no hidden replay`, t => {
    const f=fixture(t); const p=f.run(mode); assert.notEqual(p.status,0,p.stderr);
    assert.equal(p.result.execution_status,status); assert.equal(f.count(),1);
    if (mode === 'exit-seven') assert.equal(p.result.process.exit_code,7);
    assert(existsSync(join(p.dir,'stdout.json'))); assert(p.result.audit);
    if (mode.includes('edit')) assert.match(readFileSync(join(f.repo,'src/main.js'),'utf8'),/= 2/);
  });
}
test('unsupported CLI fails capability preflight without execution budget', t=>{
  const f=fixture(t); const p=f.run('old'); assert.equal(p.result.execution_status,'unsupported_protocol');assert.equal(f.count(),0);
  assert.equal(JSON.parse(readFileSync(join(p.dir,'manifest.json'))).execution_started,false);
  f.c.attempt_id='supported';const next=f.run();assert.equal(next.status,0,next.stderr);assert.equal(f.count(),1);
});
test('one dispatch can perform several internal edit/test loops before supervisor checkpoint',t=>{
  const f=fixture(t);const p=f.run('loop');assert.equal(p.status,0,p.stderr);assert.equal(f.count(),1);
  assert.deepEqual(JSON.parse(readFileSync(join(f.repo,'tests/experiment.json'),'utf8')),{red:1,green:0});
  assert.equal(p.result.execution_status,'execution_completed');assert.equal(p.result.audit.scope,'scope clean');
  assert(!('acceptance' in p.result));assert.equal(readFileSync(join(p.dir,'verification.log'),'utf8'),'');
});
test('a long task continues the explicit conversation beyond three dispatches without counters',t=>{
  const f=fixture(t);let p=f.run('ok-edit');assert.equal(p.status,0,p.stderr);
  for(let i=1;i<=4;i++) {
    f.next(`stage-${i}`,p);const previous=p;const before=readFileSync(join(previous.dir,'result.json'));
    p=f.run('ok',['--previous-run',previous.dir]);assert.equal(p.status,0,p.stderr);
    assert.deepEqual(readFileSync(join(previous.dir,'result.json')),before);
  }
  assert.equal(f.count(),5);
  const calls=readFileSync(join(f.root,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  for(const args of calls.slice(1)) {
    assert.equal(args[args.indexOf('--conversation')+1],'conv-001');assert(!args.includes('--new-project'));
  }
});
test('same task accepts reordered object keys, changed report prose and a supervisor checkpoint baseline',t=>{
  const f=fixture(t);const first=f.run('ok-edit');f.next('stage-2',first);
  f.c.constraints=Object.fromEntries(Object.entries(f.c.constraints).reverse());
  f.c.output_contract=['Different checkpoint report wording'];f.c.context='New stage context';
  writeFileSync(join(f.repo,'PROJECT_STATE.md'),'Supervisor verified stage one.');
  f.git('add','.');f.git('commit','-qm','Supervisor checkpoint');f.c.base_commit=f.git('rev-parse','HEAD');
  const p=f.run('ok',['--previous-run',first.dir]);assert.equal(p.status,0,p.stderr);
  assert.equal(p.result.native_result.conversation_id,'conv-001');assert.equal(p.result.after.head,f.c.base_commit);
});
test('continuation requires the latest completed execution and explicit binding; fresh context remains possible',t=>{
  const f=fixture(t);const first=f.run();f.next('stage-2',first);
  assert.notEqual(f.run().status,0);assert.equal(f.count(),1);
  f.c.conversation_id='wrong';assert.notEqual(f.run('ok',['--previous-run',first.dir]).status,0);assert.equal(f.count(),1);
  f.c.conversation_id=null;const fresh=f.run('ok',['--previous-run',first.dir]);assert.equal(fresh.status,0,fresh.stderr);
  const args=JSON.parse(readFileSync(join(f.root,'calls.jsonl'),'utf8').trim().split('\n')[1]);assert(args.includes('--new-project'));
  f.next('stage-3',fresh);assert.notEqual(f.run('ok',['--previous-run',first.dir]).status,0);assert.equal(f.count(),2);
});
test('missing continuation brief and changed task scope are refused without another dispatch',t=>{
  const f=fixture(t);const first=f.run();f.next('stage-2',first);delete f.c.continuation.evidence;
  assert.notEqual(f.run('ok',['--previous-run',first.dir]).status,0);
  f.next('stage-2',first);f.c.owned_files.paths.push({path:'other',kind:'directory'});
  assert.notEqual(f.run('ok',['--previous-run',first.dir]).status,0);assert.equal(f.count(),1);
});
test('permission continuation requires explicit user approval and external remediation, without changing session or history',t=>{
  const f=fixture(t);const first=f.run('permission');const original=readFileSync(join(first.dir,'result.json'));
  f.next('stage-2',first);
  for(const change of [undefined,{authorization:'agent-approval',change:'changed'},{authorization:'explicit-user-approval',change:''}]) {
    f.c.continuation.permission_change=change;
    assert.notEqual(f.run('ok',['--previous-run',first.dir]).status,0);assert.equal(f.count(),1);
  }
  f.c.continuation.permission_change={authorization:'explicit-user-approval',change:'User approved two exact file grants; supervisor applied them outside execution.'};
  const p=f.run('ok',['--previous-run',first.dir]);assert.equal(p.status,0,p.stderr);assert.equal(f.count(),2);
  assert.equal(p.result.native_result.conversation_id,first.result.native_result.conversation_id);
  assert.deepEqual(readFileSync(join(first.dir,'result.json')),original);
});
test('safe failed execution can continue with the same evidence text after a supervisor decision',t=>{
  const f=fixture(t);let p=f.run('native-error');f.next('stage-2',p);
  p=f.run('native-error',['--previous-run',p.dir]);assert.equal(p.result.execution_status,'native_failed');
  const previous=p;f.next('stage-3',previous);p=f.run('ok',['--previous-run',previous.dir]);
  assert.equal(p.status,0,p.stderr);assert.equal(f.count(),3);
});
test('scope violations and missing execution results cannot continue',t=>{
  const f=fixture(t);const first=f.run('scope');f.next('stage-2',first);
  assert.notEqual(f.run('ok',['--previous-run',first.dir]).status,0);assert.equal(f.count(),1);
  rmSync(join(first.dir,'result.json'));assert.notEqual(f.run('ok',['--previous-run',first.dir]).status,0);assert.equal(f.count(),1);
});
test('attempt IDs cannot overwrite artifacts, and an unknown returned conversation cannot be resumed',t=>{
  const f=fixture(t);const first=f.run();f.next('a0',first);
  assert.notEqual(f.run('ok',['--previous-run',first.dir]).status,0);assert.equal(f.count(),1);
  f.next('stage-2',first);const mismatch=f.run('mismatch',['--previous-run',first.dir]);
  assert.equal(mismatch.result.execution_status,'conversation_mismatch');f.next('stage-3',mismatch);
  assert.notEqual(f.run('ok',['--previous-run',mismatch.dir]).status,0);assert.equal(f.count(),2);
});
test('bypass and implicit session options remain unavailable',t=>{
  const f=fixture(t);
  for(const flag of ['--dangerously-skip-permissions','--resume-last']) assert.notEqual(f.run('ok',[flag]).status,0);
  assert.equal(f.count(),0);
});
test('initial dirty worktree and business-internal state root rejected', t=>{
  const f=fixture(t);writeFileSync(join(f.repo,'src/main.js'),'user work');const p=f.run();assert.match(p.stderr,/must be clean/);assert.equal(f.count(),0);
  const inside=join(f.repo,'state');const q=f.run('ok',['--state-root',inside]);assert.match(q.stderr,/outside/);assert(!existsSync(inside));
});
test('scope violation and unexpected commits retain modifications', t=>{
  const f=fixture(t);const p=f.run('scope');assert.equal(p.result.execution_status,'scope_violation');assert(existsSync(join(f.repo,'other.txt')));
});
test('unexpected HEAD change is detected and preserved', t=>{
  const f=fixture(t);const p=f.run('commit');assert.equal(p.result.execution_status,'scope_violation');
  const audit=p.result.audit;assert(audit.violations.includes('unexpected_HEAD_change'));
  assert.notEqual(f.git('rev-parse','HEAD'),f.c.base_commit);
});
test('staged and untracked additions, no-new-file switch, forbidden precedence', t=>{
  const f=fixture(t);const before=collectEvidence(f.repo);
  writeFileSync(join(f.repo,'tests/check.js'),'forbidden edit');writeFileSync(join(f.repo,'src/new.js'),'new');f.git('add','src/new.js');
  writeFileSync(join(f.repo,'src/untracked.js'),'untracked');
  f.c.owned_files.allow_new_files=false;const after=collectEvidence(f.repo);const a=compareEvidence(f.c,before,after);
  assert(a.violations.includes('forbidden:tests/check.js'));assert(a.violations.includes('new_file_not_allowed:src/new.js'));
  assert(a.violations.includes('new_file_not_allowed:src/untracked.js'));assert(after.staged.length);assert(after.untracked.includes('src/untracked.js'));
});
test('rename records both paths and deletions; forbidden old path still violates', t=>{
  const f=fixture(t);const before=collectEvidence(f.repo);f.git('mv','tests/check.js','src/moved.js');f.git('rm','src/main.js');
  const a=compareEvidence(f.c,before,collectEvidence(f.repo));assert.equal(a.renames.length,1);assert(a.deletions.length);
  assert(a.changed_paths.includes('tests/check.js'));assert(a.changed_paths.includes('src/moved.js'));assert(a.violations.includes('forbidden:tests/check.js'));
});
test('fingerprint detects edits to already dirty files and detached HEAD works', t=>{
  const f=fixture(t);f.git('checkout','--detach');writeFileSync(join(f.repo,'src/main.js'),'dirty1');const a=collectEvidence(f.repo);
  writeFileSync(join(f.repo,'src/main.js'),'dirty2');const b=collectEvidence(f.repo);assert.notEqual(a.fingerprint,b.fingerprint);assert.equal(a.branch,'');
});
test('fingerprint detects changed staged blob even with identical status and working content',t=>{
  const f=fixture(t);const file=join(f.repo,'src/main.js');
  writeFileSync(file,'staged-one');f.git('add','src/main.js');writeFileSync(file,'working');const before=collectEvidence(f.repo);
  writeFileSync(file,'staged-two');f.git('add','src/main.js');writeFileSync(file,'working');const after=collectEvidence(f.repo);
  assert.deepEqual(before.staged,after.staged);assert.deepEqual(before.unstaged,after.unstaged);
  assert.notEqual(before.fingerprint,after.fingerprint);
});
test('audit CLI is evidence-only with machine output and violation exit', t=>{
  const f=fixture(t);writeFileSync(f.contract,JSON.stringify(f.c));const c=loadContract(f.contract);const before=collectEvidence(f.repo);
  const baseline=join(f.root,'checkpoint.json');writeFileSync(baseline,JSON.stringify({before}));writeFileSync(join(f.repo,'tests/check.js'),'forbidden');
  const p=spawnSync(process.execPath,[join(skill,'scripts/audit.mjs'),'after',f.contract,baseline],{encoding:'utf8'});
  assert.equal(p.status,1);assert.equal(JSON.parse(p.stdout).scope,'scope violation');assert.equal(readFileSync(join(f.repo,'tests/check.js'),'utf8'),'forbidden');
  assert.equal(c.goal,f.c.goal);
});
test('cancellation preserves partial UTF-8 stdout, changes and result',async t=>{
  const f=fixture(t);writeFileSync(f.contract,JSON.stringify(f.c));
  const child=spawn(process.execPath,f.args([]),{env:f.env('hang'),stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',v=>stderr+=v);let stdout='';child.stdout.on('data',v=>stdout+=v);
  const closed=new Promise(r=>child.once('close',(code,signal)=>r({code,signal})));
  t.after(()=>{try{child.kill('SIGKILL');}catch{}});
  for(let i=0;i<200&&!f.count();i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(f.count(),1,stderr);await new Promise(r=>setTimeout(r,30));child.kill('SIGTERM');const p=await closed;
  assert.notEqual(p.code,0);const summary=JSON.parse(stdout.trim());const result=JSON.parse(readFileSync(summary.result));
  assert.equal(result.execution_status,'aborted');assert.match(readFileSync(join(dirname(summary.result),'stdout.json'),'utf8'),/保留/);
  assert.match(readFileSync(join(f.repo,'src/main.js'),'utf8'),/= 2/);assert.equal(f.count(),1);
});
test('single executor lock and SIGKILL escalation for resistant child',async t=>{
  const f=fixture(t);writeFileSync(f.contract,JSON.stringify(f.c));
  const child=spawn(process.execPath,f.args([]),{env:f.env('hang-resistant'),stdio:['ignore','pipe','pipe']});
  let stdout='';child.stdout.on('data',v=>stdout+=v);child.stderr.resume();
  const closed=new Promise(r=>child.once('close',r));
  t.after(()=>{try{child.kill('SIGKILL');}catch{}});
  for(let i=0;i<200&&!f.count();i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(f.count(),1);await new Promise(r=>setTimeout(r,40));
  f.c.task_id='another-task';f.c.attempt_id='another-attempt';
  const second=f.run();assert.notEqual(second.status,0);assert.match(second.stderr,/EEXIST/);assert.equal(f.count(),1);
  child.kill('SIGTERM');await closed;
  const summary=JSON.parse(stdout.trim());const result=JSON.parse(readFileSync(summary.result));
  assert.equal(result.execution_status,'aborted');assert.equal(result.process.terminated,true);
  assert.equal(result.process.signal,'SIGKILL');assert.equal(result.process.relay_signal,'SIGTERM');
  assert(!existsSync(join(f.state,'.active')));
});
test('inherited pipes drain; surviving descendant is unknown and retains lock',t=>{
  const f=fixture(t);const p=f.run('orphan');
  const manifest=JSON.parse(readFileSync(join(p.dir,'manifest.json')));
  // This process group was created by this test just now, not adopted from an old run.
  t.after(()=>{try{process.kill(-manifest.child_pid,'SIGKILL');}catch{}});
  assert.equal(p.result.execution_status,'process_unknown');assert.equal(p.result.process.terminated,false);
  assert(existsSync(join(f.state,'.active')));assert.equal(f.count(),1);
});
test('real relay watchdog preserves partial output and edits when AGY ignores print timeout',{timeout:80000},async t=>{
  const f=fixture(t);f.c.timeout=1;writeFileSync(f.contract,JSON.stringify(f.c));
  const child=spawn(process.execPath,f.args([]),{env:f.env('hang'),stdio:['ignore','pipe','pipe']});
  let stdout='';child.stdout.on('data',v=>stdout+=v);child.stderr.resume();
  t.after(()=>{try{child.kill('SIGKILL');}catch{}});
  await new Promise(r=>child.once('close',r));
  const summary=JSON.parse(stdout.trim());const result=JSON.parse(readFileSync(summary.result));
  assert.equal(result.execution_status,'timeout');assert.equal(result.process.terminated,true);
  assert.match(readFileSync(join(dirname(summary.result),'stdout.json'),'utf8'),/partial/);
  assert.match(readFileSync(join(f.repo,'src/main.js'),'utf8'),/= 2/);assert.equal(f.count(),1);
});
