// Guardrail: TEST-ONLY in-memory scope change applied to real uploaded Worker source.
// Never saves modified Worker source to disk and never touches production.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {classifyQlooRequest, offlineQlooResponse} from './strict_qloo_mock.mjs';
const indexFile=path.resolve('worker/index.js');
const original=fs.readFileSync(indexFile,'utf8');
const originalHash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(original));
const ids=[...original.matchAll(/\bid:\s*"([A-F0-9-]{36})"/g)].slice(0,3).map(m=>m[1]);
assert.equal(ids.length,3);
const realTagSitar=original.match(/sitar:\s*"([^"]+)"/)?.[1];
const realTagClassical=original.match(/classical:\s*"([^"]+)"/)?.[1];
const aud=original.match(/bts:\s*"([^"]+)"/)?.[1];
assert.ok(realTagSitar&&realTagClassical&&aud);
// Change ONLY first CANDIDATES entry from scope 2 to scope 1 in memory.
const anchor=/((?:const\s+CANDIDATES\s*=\s*\[\s*\{)[\s\S]*?\bid:\s*"[A-F0-9-]{36}"[\s\S]*?\bscope:\s*)2/;
assert.ok(anchor.test(original), 'Actual first candidate must initially have scope=2');
const modified=original.replace(anchor,(_,p)=>p+'1');
assert.notEqual(modified,original);
const proofUrl=pathToFileURL(path.resolve('worker/proof.mjs')).href;
const repl=modified.replace(/from\s+['"]\.\/proof\.mjs['"]/g,`from '${proofUrl}'`);
const worker=(await import('data:text/javascript;base64,'+Buffer.from(repl).toString('base64'))).default;
const requestCtx={candidateIds:ids,audienceSignal:aud,preserveTags:{sitar:realTagSitar,classical:realTagClassical},expectedRankingIds:[ids[0]]};
const originalFetch=globalThis.fetch;
const calls=[];
try{
 globalThis.fetch=async(input,init)=>{
  const url=input instanceof URL?input:new URL(input);
  const method=init?.method||'GET';
  calls.push(url.href);
  const decoded=classifyQlooRequest(url,method,requestCtx);
  if(decoded.kind==='constraint'){
   return offlineQlooResponse(decoded.tag==='sitar'?[ids[0],ids[1],ids[2]]:[ids[0],ids[1]],decoded.tag);
  }
  return offlineQlooResponse([ids[0]],'lowest-scope');
 };
 const req=new Request('https://cultureshift-ai.workers.dev/api/evaluate',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({audience:'bts',preserve:['sitar','classical']})
 });
 const res=await worker.fetch(req,{QLOO_API_KEY:'MOCK_NOT_A_REAL_SECRET'},{});
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.decision,'BRIDGE_FOUND');
 assert.equal(data.interventionScope,1);
 assert.deepEqual(data.candidatesConsidered,[ids[0]]);
 assert.deepEqual(data.decision_proof.constraint_evidence_summary.intersected_entity_ids.map(x=>x.toLowerCase()).sort(),[ids[0],ids[1]].map(x=>x.toLowerCase()).sort());
 assert.equal(data.ranking.results.length,1);
 assert.equal(data.ranking.results[0].entity_id.toLowerCase(),ids[0].toLowerCase());
 assert.equal(data.decision_proof.selected_candidate.entity_id.toLowerCase(),ids[0].toLowerCase());
 assert.equal(data.decision_proof.proof_integrity_status,'VERIFIED_PROTECTED_BRIDGE');
 assert.equal(calls.length,3);
 // Mutation detection: a Worker that ranks scope-2 candidate must be rejected by the mock.
 const bad=new URL('https://hackathon.api.qloo.com/v2/insights');
 for(const [k,v] of Object.entries({'filter.type':'urn:entity:artist','filter.results.entities':ids.slice(0,2).join(','),take:'2','signal.interests.entities':aud})) bad.searchParams.set(k,v);
 assert.throws(()=>classifyQlooRequest(bad,'GET',requestCtx),/rank set/);
 console.log('PASS: actual-source-based in-memory mixed-scope regression; intersection 2, only scope-1 ranked; 3 offline calls; bad rank-all-scopes rejected');
}finally{globalThis.fetch=originalFetch;}
const after=fs.readFileSync(indexFile,'utf8');
const afterHash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(after));
assert.deepEqual(new Uint8Array(afterHash),new Uint8Array(originalHash),'Original Worker source must be unchanged on disk');
console.log('PASS: actual Worker source remains unchanged; no real Qloo API calls, no local or live deployment');
