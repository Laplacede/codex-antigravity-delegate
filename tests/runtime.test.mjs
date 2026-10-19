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
    const obj = {conversation_id:mode === 'mismatch' ? 'other-conversation' : c.conversation_id || (c.recovery ? 'conv-recovered' : 'conv-001'),status:mode === 'native-error' ? 'ERROR' : 'SUCCESS',response:mode === 'empty-response' ? '' : '已完成：root cause, modified files, validations, unresolved issues, no blockers. permission denied is quoted report text only.'};
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
    base_commit:git('rev-parse','HEAD'), conversation_id:null, permission_profile:'authorized-local-write',
    authorization_scope:'Fixture local code only', capability_review:'Fixture binary; no external tools', sandbox:false,
    timeout:5, corrective_attempts_used:0, goal:'Fix module',context:'Disposable fixture',
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
  const correction = (n, id=`a${n}`) => {
    c.attempt_id=id; c.corrective_attempts_used=n;
    c.correction={observed_failure:'Specific failed acceptance',evidence:`fresh evidence ${n}`,expected_behavior:'pass',rerun_command:'node --check src/main.js',process_confirmed_stopped:true,external_side_effects_clear:true};
  };
  return {root,repo,bin,state,git,c,contract,env,args,run,count,correction,helpCalls};
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
  assert.equal(p.result.acceptance,'pending_supervisor_verification');
  assert.match(p.result.agent_report,/已完成/); assert.equal(p.result.native_status,'SUCCESS');
  assert.equal(f.count(),1);
  const args=JSON.parse(readFileSync(join(f.root,'calls.jsonl'),'utf8').trim());
  assert(args.includes('--output-format')); assert(args.includes(realpathSync(f.repo)));
  assert(!args.includes('--dangerously-skip-permissions')); assert(!args.includes('--continue'));
  for (const name of ['contract.md','manifest.json','stdout.json','stderr.log','result.json','before.json','after.json','audit.json','verification.log']) assert(existsSync(join(p.dir,name)),name);
  assert.equal(JSON.parse(readFileSync(join(p.dir,'audit.json'))).scope,'scope clean');
  assert.equal(readFileSync(join(p.dir,'verification.log'),'utf8'),'');
});
for (const [mode,status] of [['bad-edit','malformed_json'],['empty','empty_output'],['empty-response','empty_output'],['permission','permission_blocked'],['timeout-edit','partial_output'],['network','network_uncertainty'],['auth','authentication_blocked'],['quota','quota_blocked'],['wrong-shape','unsupported_protocol'],['native-error','native_failed'],['old-response','malformed_json'],['exit-seven','failed']]) {
  test(`${mode}: fails with raw artifacts and no hidden replay`, t => {
    const f=fixture(t); const p=f.run(mode); assert.notEqual(p.status,0,p.stderr);
    assert.equal(p.result.execution_status,status); assert.equal(f.count(),1);
    if (mode === 'exit-seven') assert.equal(p.result.process_exit_code,7);
    assert(existsSync(join(p.dir,'stdout.json'))); assert(existsSync(join(p.dir,'audit.json')));
    if (mode.includes('edit')) assert.match(readFileSync(join(f.repo,'src/main.js'),'utf8'),/= 2/);
  });
}
test('unsupported CLI fails capability preflight without execution budget', t=>{
  const f=fixture(t); const p=f.run('old'); assert.equal(p.result.execution_status,'unsupported_protocol');assert.equal(f.count(),0);
  assert.equal(JSON.parse(readFileSync(join(p.dir,'manifest.json'))).execution_started,false);
  f.c.attempt_id='supported';const next=f.run();assert.equal(next.status,0,next.stderr);assert.equal(f.count(),1);
});
test('explicit resume and two corrections; fresh conversation cannot reset task budget', t=>{
  const f=fixture(t);const first=f.run('ok-edit');assert.equal(first.status,0,first.stderr);
  f.correction(1);f.c.conversation_id=first.result.conversation_id;
  const second=f.run('ok',['--previous-run',first.dir]);assert.equal(second.status,0,second.stderr);
  const calls=readFileSync(join(f.root,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert(calls[1].includes('--conversation'));assert(calls[1].includes('conv-001'));assert(!calls[1].includes('--new-project'));
  f.correction(2);f.c.conversation_id=null;
  const third=f.run('ok',['--previous-run',second.dir]);assert.equal(third.status,0,third.stderr);
  f.c.attempt_id='fourth';const fourth=f.run('ok',['--previous-run',third.dir]);
  assert.notEqual(fourth.status,0);assert.match(fourth.stderr,/exhausted/);assert.equal(f.count(),3);
});
test('incorrect retry count and reused attempt ID rejected without replay', t=>{
  const f=fixture(t);const first=f.run();
  f.c.attempt_id='another';const p=f.run('ok',['--previous-run',first.dir]);assert.match(p.stderr,/must equal 1/);
  f.correction(1,'a0');const reused=f.run('ok',['--previous-run',first.dir]);assert.notEqual(reused.status,0);assert.equal(f.count(),1);
});
test('resume mismatch is blocked before dispatch; runtime ID mismatch is preserved', t=>{
  const f=fixture(t);const first=f.run();f.correction(1);f.c.conversation_id='wrong';
  const p=f.run('ok',['--previous-run',first.dir]);assert.match(p.stderr,/mismatch/);assert.equal(f.count(),1);
  f.c.conversation_id='conv-001';const mismatch=f.run('mismatch',['--previous-run',first.dir]);
  assert.equal(mismatch.result.execution_status,'conversation_mismatch');assert.equal(mismatch.result.conversation_trusted,false);
});
test('changed workspace/session binding cannot resume another repository', t=>{
  const f=fixture(t);const first=f.run();const other=fixture(t);
  other.c.conversation_id='conv-001';
  const p=other.run('ok',['--session-from',first.dir]);assert.match(p.stderr,/binding\/state mismatch/);
  assert.equal(other.count(),0);assert.equal(f.count(),1);
});
test('changed Git state blocks correction before dispatch', t=>{
  const f=fixture(t);const first=f.run();f.correction(1);writeFileSync(join(f.repo,'src/main.js'),'another writer');
  const p=f.run('ok',['--previous-run',first.dir]);assert.match(p.stderr,/differs/);assert.equal(f.count(),1);
});
test('new evidence required and blockers do not automatically retry', t=>{
  const f=fixture(t);const first=f.run('permission');f.correction(1);
  const p=f.run('ok',['--previous-run',first.dir]);assert.match(p.stderr,/requires supervisor recovery/);assert.equal(f.count(),1);
});
function permissionRecovery(f, first, n=1) {
  f.correction(n);
  f.c.conversation_id=null;
  f.c.recovery={from_attempt_id:JSON.parse(readFileSync(join(first.dir,'manifest.json'),'utf8')).attempt_id,
    reason:'permission_blocked',authorization:'explicit-user-approval',change:'Supervisor added two explicitly approved exact file write permissions outside execution.'};
}
for (const [name,mutate,pattern] of [
  ['missing metadata',f=>{delete f.c.recovery;},/requires supervisor recovery/],
  ['wrong attempt',f=>{f.c.recovery.from_attempt_id='other';},/permission recovery requires/],
  ['wrong reason',f=>{f.c.recovery.reason='quota_blocked';},/permission recovery requires/],
  ['missing authorization',f=>{delete f.c.recovery.authorization;},/permission recovery requires/],
  ['non-explicit authorization',f=>{f.c.recovery.authorization='agent-approval';},/permission recovery requires/],
  ['missing external change',f=>{f.c.recovery.change=' ';},/permission recovery requires/],
  ['wrong counter',f=>{f.c.corrective_attempts_used=0;},/must equal 1/],
  ['expanded ownership',f=>{f.c.owned_files.paths.push({path:'other',kind:'directory'});},/binding changed/],
  ['removed forbidden path',f=>{f.c.forbidden_files=[];},/binding changed/],
  ['changed goal',f=>{f.c.goal='Different goal';},/binding changed/],
  ['changed acceptance',f=>{f.c.acceptance_criteria=['Weaker'];},/binding changed/],
  ['changed base',f=>{f.c.base_commit='0'.repeat(40);},/binding changed/],
  ['unbound conversation',f=>{f.c.conversation_id='wrong';},/conversation binding\/state mismatch/],
  ['changed Git',f=>{writeFileSync(join(f.repo,'src/main.js'),'another writer');},/Git state differs/],
  ['uncertain external side effects',f=>{f.c.correction.external_side_effects_clear=false;},/process and side-effect review/],
]) {
  test(`permission recovery rejects ${name} without execution`,t=>{
    const f=fixture(t);const first=f.run('permission');permissionRecovery(f,first);
    mutate(f);const p=f.run('ok',['--previous-run',first.dir]);
    assert.notEqual(p.status,0);assert.match(p.stderr,pattern);assert.equal(f.count(),1);
  });
}
for (const mode of ['auth','quota','network','wrong-shape','scope','ok']) {
  test(`permission recovery cannot override ${mode}`,t=>{
    const f=fixture(t);const first=f.run(mode);permissionRecovery(f,first);
    const p=f.run('ok',['--previous-run',first.dir]);assert.notEqual(p.status,0);
    assert.match(p.stderr,/permission recovery requires/);assert.equal(f.count(),1);
  });
}
for (const [name,file,mutate] of [
  ['unknown process','result.json',v=>{v.process_terminated=false;}],
  ['scope uncertainty','result.json',v=>{v.audit_scope='audit failed';}],
  ['wrong result task','result.json',v=>{v.task_id='other';}],
  ['wrong manifest task','manifest.json',v=>{v.task_id='other';}],
  ['wrong result attempt','result.json',v=>{v.attempt_id='other';}],
  ['no execution reservation','manifest.json',v=>{v.execution_started=false;}],
]) {
  test(`permission recovery rejects fixture history with ${name}`,t=>{
    const f=fixture(t);const first=f.run('permission');permissionRecovery(f,first);
    // Synthetic corrupt/uncertain history, confined to this disposable test fixture.
    const path=join(first.dir,file);const value=JSON.parse(readFileSync(path,'utf8'));
    mutate(value);writeFileSync(path,JSON.stringify(value));
    const p=f.run('ok',['--previous-run',first.dir]);assert.notEqual(p.status,0);assert.equal(f.count(),1);
    assert.match(p.stderr,/permission recovery requires|must equal/);
  });
}
test('permission recovery needs previous execution and the latest previous-run',t=>{
  const f=fixture(t);f.c.recovery={from_attempt_id:'missing',reason:'permission_blocked',authorization:'explicit-user-approval',change:'approved files'};
  const initial=f.run();assert.match(initial.stderr,/requires a previous execution/);assert.equal(f.count(),0);
  delete f.c.recovery;const first=f.run('permission');permissionRecovery(f,first);
  const noPrevious=f.run();assert.match(noPrevious.stderr,/latest execution attempt/);assert.equal(f.count(),1);
  const resumed=f.run('ok',['--previous-run',first.dir,'--session-from',first.dir]);
  assert.match(resumed.stderr,/--session-from requires explicit conversation_id/);assert.equal(f.count(),1);
});
test('authorized permission recovery without conversation ID preserves history and consumes corrective budget',t=>{
  const f=fixture(t);const first=f.run('permission');
  const historyFiles=['manifest.json','result.json','after.json','stdout.json','stderr.log'];
  const originals=historyFiles.map(name=>readFileSync(join(first.dir,name)));
  permissionRecovery(f,first);const second=f.run('ok',['--previous-run',first.dir]);
  assert.equal(second.status,0,second.stderr);assert.equal(f.count(),2);
  const calls=readFileSync(join(f.root,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert(calls[1].includes('--new-project'));assert(!calls[1].includes('--conversation'));
  assert(!calls[1].includes('--dangerously-skip-permissions'));
  const manifest=JSON.parse(readFileSync(join(second.dir,'manifest.json'),'utf8'));
  assert.equal(manifest.corrective_attempts_used,1);assert.equal(manifest.attempt_number,2);
  assert.equal(manifest.contract.conversation_id,null);assert.equal(second.result.conversation_id,'conv-recovered');
  assert.notEqual(second.result.conversation_id,first.result.conversation_id);assert.deepEqual(manifest.contract.recovery,f.c.recovery);
  assert.equal(second.result.acceptance,'pending_supervisor_verification');
  historyFiles.forEach((name,i)=>assert.deepEqual(readFileSync(join(first.dir,name)),originals[i]));
  assert.equal(JSON.parse(originals[1]).retry_blocker,true);
  delete f.c.recovery;f.correction(2);const third=f.run('permission',['--previous-run',second.dir]);
  assert.equal(third.result.execution_status,'permission_blocked');assert.equal(f.count(),3);
  permissionRecovery(f,third,2);f.c.attempt_id='fourth';
  const fourth=f.run('ok',['--previous-run',third.dir]);assert.match(fourth.stderr,/exhausted/);assert.equal(f.count(),3);
});
test('authorized permission recovery can resume the bound explicit conversation',t=>{
  const f=fixture(t);const first=f.run('permission');permissionRecovery(f,first);
  f.c.conversation_id=first.result.conversation_id;
  const second=f.run('ok',['--previous-run',first.dir]);
  assert.equal(second.status,0,second.stderr);assert.equal(f.count(),2);
  const calls=readFileSync(join(f.root,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls[1][calls[1].indexOf('--conversation')+1],first.result.conversation_id);
  assert(!calls[1].includes('--new-project'));
  assert.equal(second.result.conversation_id,first.result.conversation_id);
  const manifest=JSON.parse(readFileSync(join(second.dir,'manifest.json'),'utf8'));
  assert.equal(manifest.corrective_attempts_used,1);assert.equal(manifest.attempt_number,2);
  assert.equal(JSON.parse(readFileSync(join(first.dir,'result.json'),'utf8')).retry_blocker,true);
});
test('missing or repeated corrective evidence does not consume another execution',t=>{
  const f=fixture(t);const first=f.run();f.correction(1);delete f.c.correction.observed_failure;
  const missing=f.run('ok',['--previous-run',first.dir]);assert.match(missing.stderr,/observed_failure required/);assert.equal(f.count(),1);
  f.correction(1);const second=f.run('ok',['--previous-run',first.dir]);assert.equal(second.status,0,second.stderr);
  const oldEvidence=f.c.correction.evidence;f.correction(2);f.c.correction.evidence=oldEvidence;
  const repeated=f.run('ok',['--previous-run',second.dir]);assert.match(repeated.stderr,/new evidence/);assert.equal(f.count(),2);
});
test('malformed output requires explicit recovery review before correction',t=>{
  const f=fixture(t);const first=f.run('bad-edit');f.correction(1);delete f.c.correction.external_side_effects_clear;
  const p=f.run('ok',['--previous-run',first.dir]);assert.match(p.stderr,/process and side-effect review/);assert.equal(f.count(),1);
  f.c.correction.external_side_effects_clear=true;const next=f.run('ok',['--previous-run',first.dir]);assert.equal(next.status,0,next.stderr);assert.equal(f.count(),2);
});
test('acceptance and verification boundary cannot be weakened in a correction',t=>{
  const f=fixture(t);const first=f.run();f.correction(1);f.c.verification_commands[0].command='true';
  const p=f.run('ok',['--previous-run',first.dir]);assert.match(p.stderr,/binding changed/);assert.equal(f.count(),1);
});
test('initial dirty worktree and business-internal state root rejected', t=>{
  const f=fixture(t);writeFileSync(join(f.repo,'src/main.js'),'user work');const p=f.run();assert.match(p.stderr,/must be clean/);assert.equal(f.count(),0);
  const inside=join(f.repo,'state');const q=f.run('ok',['--state-root',inside]);assert.match(q.stderr,/outside/);assert(!existsSync(inside));
});
test('read-only or bypass claims are not silently enabled', t=>{
  const f=fixture(t);f.c.permission_profile='read-only';const p=f.run();assert.match(p.stderr,/no verified read-only/);assert.equal(f.count(),0);
  f.c.permission_profile='authorized-local-write';const q=f.run('ok',['--dangerously-skip-permissions']);assert.match(q.stderr,/invalid/);assert.equal(f.count(),0);
});
test('missing result requires recovery; never overwrites or restarts attempt', t=>{
  const f=fixture(t);const first=f.run();rmSync(join(first.dir,'result.json'));f.correction(1);
  const p=f.run('ok',['--previous-run',first.dir]);assert.match(p.stderr,/missing result/);assert.equal(f.count(),1);
});
test('scope violation and unexpected commits retain modifications', t=>{
  const f=fixture(t);const p=f.run('scope');assert.equal(p.result.execution_status,'scope_violation');assert(existsSync(join(f.repo,'other.txt')));
});
test('unexpected HEAD change is detected, preserved and blocks correction', t=>{
  const f=fixture(t);const p=f.run('commit');assert.equal(p.result.execution_status,'scope_violation');
  const audit=JSON.parse(readFileSync(join(p.dir,'audit.json')));assert(audit.violations.includes('unexpected_HEAD_change'));
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
  const baseline=join(f.root,'before.json');writeFileSync(baseline,JSON.stringify(before));writeFileSync(join(f.repo,'tests/check.js'),'forbidden');
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
  assert.equal(result.execution_status,'aborted');assert.equal(result.process_terminated,true);
  assert.equal(result.signal,'SIGKILL');assert.equal(result.relay_signal,'SIGTERM');
  assert(!existsSync(join(f.state,'.active')));
});
test('inherited pipes drain; surviving descendant is unknown and retains lock',t=>{
  const f=fixture(t);const p=f.run('orphan');
  const manifest=JSON.parse(readFileSync(join(p.dir,'manifest.json')));
  // This process group was created by this test just now, not adopted from an old run.
  t.after(()=>{try{process.kill(-manifest.child_pid,'SIGKILL');}catch{}});
  assert.equal(p.result.execution_status,'process_unknown');assert.equal(p.result.process_terminated,false);
  assert(existsSync(join(f.state,'.active')));assert.equal(f.count(),1);
});
test('real relay watchdog preserves partial output and edits when AGY ignores print timeout',{timeout:80000},async t=>{
  const f=fixture(t);f.c.timeout=1;writeFileSync(f.contract,JSON.stringify(f.c));
  const child=spawn(process.execPath,f.args([]),{env:f.env('hang'),stdio:['ignore','pipe','pipe']});
  let stdout='';child.stdout.on('data',v=>stdout+=v);child.stderr.resume();
  t.after(()=>{try{child.kill('SIGKILL');}catch{}});
  await new Promise(r=>child.once('close',r));
  const summary=JSON.parse(stdout.trim());const result=JSON.parse(readFileSync(summary.result));
  assert.equal(result.execution_status,'timeout');assert.equal(result.process_terminated,true);
  assert.match(readFileSync(join(dirname(summary.result),'stdout.json'),'utf8'),/partial/);
  assert.match(readFileSync(join(f.repo,'src/main.js'),'utf8'),/= 2/);assert.equal(f.count(),1);
});
