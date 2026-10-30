// Deterministic UI → REAL Worker source → mocked Qloo integration.
// No live requests or credentials. Verifies visible audit, refusal, tamper, and XSS behaviors.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { classifyQlooRequest, offlineQlooResponse } from './strict_qloo_mock.mjs';

const workerSource = fs.readFileSync('./worker/index.js', 'utf8');
const proofUrl = pathToFileURL(`${process.cwd()}/worker/proof.mjs`).href;
const workerModule = await import('data:text/javascript;base64,' + Buffer.from(workerSource.replace(/from\s+['"]\.\/proof\.mjs['"]/g, `from '${proofUrl}'`)).toString('base64'));
const worker = workerModule.default;
const candidates = [...workerSource.matchAll(/\bid:\s*"([A-Z0-9-]{36})"/g)].map(x=>x[1]).slice(0,3);
assert.equal(candidates.length,3);
const [a,b,c] = candidates;
const sitar = 'urn:tag:instrument:qloo:sitar';
const classical = 'urn:tag:genre:music:indian_classical';
const audience = 'F347D506-CB6F-46FA-9A8B-AFBC31C71A1A';
let counter = 0;
const originalFetch = globalThis.fetch;
async function scenario({mode='success', checked=true, mutate=null}) {
  const status = {calls:[], qloo:[]};
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.href);
    const context = {
      candidateIds: candidates, audienceSignal: audience,
      preserveTags:{sitar,classical},
      expectedRankingIds: mode==='unprotected' ? candidates : [a,b]
    };
    const classified = classifyQlooRequest(url, String(init?.method || 'GET').toUpperCase(), context);
    status.qloo.push(classified.kind);
    if(classified.kind==='ranking') return offlineQlooResponse(mode==='unprotected'?candidates:[a,b]);
    if(mode==='refusal') return offlineQlooResponse(classified.tag==='sitar'?[a]:[b]);
    return offlineQlooResponse([a,b]);
  };
  try {
    const els = {
      'run-button': { addEventListener(type,callback) {this.callback=callback;}, disabled:false, textContent:''},
      'result': { innerHTML:'' },
      'audience': {value:'bts'},
      'protect-classical':{checked: mode==='unprotected'?false:checked},
      'protect-sitar':{checked: mode==='unprotected'?false:checked}
    };
    const browserFetch = async (path, init) => {
      status.calls.push(path);
      const response = await worker.fetch(new Request('https://culture.example'+path, init), {QLOO_API_KEY:'offline-test-key'});
      if(path === '/api/evaluate' && mutate) {
        const data=await response.json();
        mutate(data);
        return new Response(JSON.stringify(data), {status:response.status,headers:{'Content-Type':'application/json'}});
      }
      return response;
    };
    const ctx={document:{getElementById(id){assert.ok(els[id]);return els[id];}},fetch:browserFetch,console};
    vm.runInNewContext(fs.readFileSync('./public/app.js','utf8'),ctx);
    await els['run-button'].callback();
    assert.equal(els['run-button'].disabled,false);
    assert.equal(els['run-button'].textContent,'Find Minimum Cultural Bridge');
    return {html:els.result.innerHTML, status};
  } finally {globalThis.fetch=originalFetch;}
}
const checks=[];
function check(label,condition){assert.ok(condition,label);checks.push(label); console.log(`[PASS ${checks.length}] ${label}`)}
let x=await scenario({});
check('Protected result shows Guardian decision audit',x.html.includes('GUARDIAN · DECISION AUDIT') && x.html.includes('Protected recommendation verified'));
check('Protected result records actual minimum scope, SHA and limitations',x.html.includes('Intervention scope') && x.html.includes('sha256:') && x.html.includes('does not authenticate the upstream Qloo API'));
check('Success uses real Worker endpoints and 3 isolated Qloo calls',x.status.calls.join('|')==='/api/evaluate|/api/interventions' && x.status.qloo.length===3);
x=await scenario({mode:'refusal'});
check('Refusal shows auditable safe rejection without recommending a candidate',x.html.includes('Consistent refusal') && x.html.includes('Do Not Change') && !x.html.includes('Protected recommendation verified'));
check('Empty intersection never makes ranking call',x.status.qloo.join(',')==='constraint,constraint' && x.status.calls.length===1);
x=await scenario({mutate:r=>{r.decision_proof.proof_integrity_status='CANDIDATE_OR_CONSTRAINT_MISMATCH';}});
check('Tampered proof status fails closed, no intervention request',x.html.includes('Result withheld') && x.status.calls.length===1);
x=await scenario({mutate:r=>{delete r.decision_proof;}});
check('Missing decision proof fails closed',x.html.includes('Result withheld') && x.status.calls.length===1);
x=await scenario({mutate:r=>{r.decision_proof.selected_candidate.entity_id=c;}});
check('Mismatched winner fails closed',x.html.includes('Result withheld') && x.status.calls.length===1);
x=await scenario({mode:'unprotected'});
check('No checked preservation constraints are visibly disclosed',x.html.includes('Unprotected evaluation') && x.html.includes('not be described as identity-protected'));
x=await scenario({mutate:r=>{r.ranking.results[0].name='<img src=x onerror=alert(1)>';}});
check('Ranking names are escaped against HTML injection',x.html.includes('&lt;img src=x onerror=alert(1)&gt;') && !x.html.includes('<img src=x onerror=alert(1)>'));
console.log(`ALL ${checks.length}/${checks.length} OFFLINE JUDGE UI TESTS PASSED`);
