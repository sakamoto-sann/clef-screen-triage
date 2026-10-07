import {test, expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const helper = fileURLToPath(new URL('../scripts/triage.py', import.meta.url));
const python = process.env.PYTHON ?? 'python3';
function probe(code) {
  return execFileSync(python, ['-c', `
import importlib.util, sys, json, time, io, tempfile, datetime, os, base64, fcntl
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('m',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
image_bytes=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=')
raw={'answers':{'visual_state':{'choice':'content','confidence':0.8,'probabilities':{'content':0.95,'loading':0.02,'error':0.02,'unknown':0.01}}},'usage':{'input_tokens':900,'output_tokens':0}}
${code}
`, helper], {encoding:'utf8', env:{...process.env, CLOUDFLARE_API_TOKEN:'', CLOUDFLARE_ACCOUNT_ID:'', WRANGLER_PROFILE:''}}).trim();
}

test('valid inference uses configured account and caches without further authentication', () => {
  expect(probe(`
with tempfile.TemporaryDirectory() as folder:
 c=Path(folder)/'cache';image=Path(folder)/'screen.png';image.write_bytes(image_bytes)
 auth=[];calls=[]
 def response(req,timeout):
  calls.append(req.full_url)
  assert req.get_header('Authorization')=='Bearer fixture-token'
  return io.BytesIO(json.dumps({'success':True,'result':raw}).encode())
 with patch.dict(os.environ,{'CLOUDFLARE_ACCOUNT_ID':'0'*32}),patch.object(m,'credential',lambda:auth.append(1) or 'fixture-token'),patch.object(m.urllib.request,'urlopen',response):
  a=m.classify(image,c,0)
 # Cache must work even after credentials/account become unavailable.
 b=m.classify(image,c,0)
 assert a['route']==b['route']=='continue_visual_check'
 assert not a['cache_hit'] and b['cache_hit'] and len(auth)==len(calls)==1
 assert '/accounts/'+('0'*32)+'/ai/run/' in calls[0]
 day=datetime.datetime.now(datetime.timezone.utc).date().isoformat()
 ledger=json.loads((c/f'usage-{day}.json').read_text())
 assert ledger['calls']==1 and abs(ledger['neurons']-7.3638)<1e-6
 for p in c.glob('*.json'):
  assert 'fixture-token' not in p.read_text() and 'data:image' not in p.read_text()
print('ok')
`)).toBe('ok');
});

test('invalid account, exhausted budgets and concurrent lock stop before auth', () => {
  expect(probe(`
def forbidden():raise AssertionError('auth must not run')
with patch.object(m,'credential',forbidden),tempfile.TemporaryDirectory() as folder:
 image=Path(folder)/'screen.png';image.write_bytes(image_bytes)
 try:m.classify(image,Path(folder)/'unconfigured',0)
 except RuntimeError:pass
 else:raise AssertionError('Missing account allowed')
 day=datetime.datetime.now(datetime.timezone.utc).date().isoformat()
 with patch.dict(os.environ,{'CLOUDFLARE_ACCOUNT_ID':'0'*32}):
  for i,ledger in enumerate([{'calls':20,'neurons':1},{'calls':1,'neurons':850},{'calls':1,'neurons':float('nan')}]):
   c=Path(folder)/str(i);c.mkdir();(c/f'usage-{day}.json').write_text(json.dumps(ledger))
   try:m.classify(image,c,0)
   except (ValueError,RuntimeError):pass
   else:raise AssertionError('budget allowed')
  c=Path(folder)/'locked';c.mkdir()
  with (c/'budget.lock').open('a') as lock:
   fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
   try:m.classify(image,c,0)
   except BlockingIOError:pass
   else:raise AssertionError('lock bypassed')
print('ok')
`)).toBe('ok');
});

test('environment credentials and PATH Wrangler use no personal profile or path', () => {
  expect(probe(`
with patch.dict(os.environ,{'CLOUDFLARE_API_TOKEN':'fixture-token'}),patch.object(m.subprocess,'run',side_effect=AssertionError('must not spawn')):
 assert m.credential()=='fixture-token'
class Output:
 returncode=0
 stdout=json.dumps({'token':'fixture-token'})
calls=[]
def run(command,**kwargs):
 calls.append(command);assert kwargs['capture_output'] and kwargs['timeout']==30
 return Output()
with patch.object(m.shutil,'which',lambda _: '/test/bin/wrangler'),patch.object(m.subprocess,'run',run):
 assert m.credential()=='fixture-token'
 with patch.dict(os.environ,{'WRANGLER_PROFILE':'test-profile'}):
  assert m.credential()=='fixture-token'
assert calls==[['/test/bin/wrangler','auth','token','--json'],['/test/bin/wrangler','auth','token','--json','--profile','test-profile']]
print('ok')
`)).toBe('ok');
});

test('error, unknown and malformed response cannot pass the readiness gate', () => {
  expect(probe(`
for state in ['error','unknown']:
 probs={k:(0.97 if k==state else 0.01) for k in m.CRITERIA}
 assert m.decode({'answers':{'visual_state':{'choice':state,'confidence':0.9,'probabilities':probs}}})['route']=='codex'
for value in [float('nan'),True,2]:
 bad=json.loads(json.dumps(raw));bad['answers']['visual_state']['confidence']=value
 try:m.decode(bad)
 except ValueError:pass
 else:raise AssertionError('invalid probability accepted')
assert m.finish({'route':'bounded_wait'},time.monotonic()-.2,1900)['route']=='codex'
print('ok')
`)).toBe('ok');
});

test('network failure keeps its reservation and is never automatically retried', () => {
  expect(probe(`
calls=[]
def failure(req,timeout):
 calls.append(1);raise OSError('fixture failure')
with tempfile.TemporaryDirectory() as folder:
 c=Path(folder)/'cache';image=Path(folder)/'screen.png';image.write_bytes(image_bytes)
 with patch.dict(os.environ,{'CLOUDFLARE_ACCOUNT_ID':'0'*32}),patch.object(m,'credential',lambda:'fixture-token'),patch.object(m.urllib.request,'urlopen',failure):
  try:m.classify(image,c,0)
  except OSError:pass
  else:raise AssertionError('failure hidden in success')
 day=datetime.datetime.now(datetime.timezone.utc).date().isoformat()
 assert json.loads((c/f'usage-{day}.json').read_text())=={'calls':1,'neurons':100}
 assert len(calls)==1
print('ok')
`)).toBe('ok');
});

test('CLI without export authorization does not even read a nonexistent image', () => {
  const result = JSON.parse(execFileSync(python,[helper,'--image','/nonexistent.png'],{encoding:'utf8'}));
  expect(result).toEqual({route:'codex',reason:'image_export_not_authorized'});
  const bad = JSON.parse(execFileSync(python,[helper,'--image','/nonexistent.png','--public-image'],{encoding:'utf8'}));
  expect(bad).toEqual({route:'codex',reason:'provider_input_or_budget_unavailable'});
});
