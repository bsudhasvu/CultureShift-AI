import assert from 'node:assert/strict';
import {classifyQlooRequest} from './strict_qloo_mock.mjs';
const base = 'https://hackathon.api.qloo.com/v2/insights';
const cand = ['candidate_A','candidate_B','candidate_C'];
const tags = {sitar:'urn:tag:instrument:qloo:sitar', classical:'urn:tag:genre:music:indian_classical'};
const aud = 'F347D506-CB6F-46FA-9A8B-AFBC31C71A1A';
const ctx = {candidateIds:cand, audienceSignal:aud, preserveTags:tags, expectedRankingIds:['candidate_B']};
function make(tag, ids){
 const u=new URL(base);
 u.searchParams.set('filter.type','urn:entity:artist');
 u.searchParams.set('filter.results.entities',ids.join(','));
 u.searchParams.set('take',String(ids.length));
 u.searchParams.set('signal.interests.entities',aud);
 if(tag){u.searchParams.set('filter.tags',tags[tag]);u.searchParams.set('operator.filter.tags','union');}
 return u;
}
const sitar = make('sitar',cand), classical = make('classical',cand), rank=make(null,['candidate_B']);
const valid = [[sitar,'constraint'],[classical,'constraint'],[rank,'ranking']];
const cases = [];
function changed(u, fn){const v=new URL(u);fn(v);return v;}
cases.push([changed(sitar,u=>u.hostname='evil.example'),'GET','origin']);
cases.push([changed(sitar,u=>u.hostname='hackathon.api.qloo.com.evil.example'),'GET','origin']);
cases.push([changed(sitar,u=>u.protocol='http:'),'GET','origin']);
cases.push([changed(sitar,u=>u.pathname='/v2/insights/other'),'GET','only GET']);
cases.push([sitar,'POST','only GET']);
cases.push([changed(sitar,u=>u.searchParams.set('bad.key','x')),'GET','query keys']);
cases.push([changed(sitar,u=>u.searchParams.append('filter.tags',tags.classical)),'GET','query keys']);
cases.push([changed(sitar,u=>u.searchParams.delete('filter.type')),'GET','filter.type']);
cases.push([changed(sitar,u=>u.searchParams.set('filter.type','urn:entity:album')),'GET','filter.type']);
cases.push([changed(sitar,u=>u.searchParams.set('filter.tags','urn:tag:electronic')),'GET','constraint tag']);
cases.push([changed(sitar,u=>u.searchParams.set('operator.filter.tags','intersection')),'GET','operator']);
cases.push([changed(sitar,u=>u.searchParams.set('filter.results.entities','candidate_A')),'GET','take']);
cases.push([changed(sitar,u=>{u.searchParams.set('filter.results.entities','candidate_A');u.searchParams.set('take','1')}) ,'GET','constraint candidate']);
cases.push([changed(rank,u=>u.searchParams.set('signal.interests.entities','spoof')),'GET','audience']);
cases.push([changed(rank,u=>u.searchParams.set('filter.results.entities','candidate_A')),'GET','rank set']);
cases.push([changed(rank,u=>u.searchParams.set('filter.results.entities','candidate_B,candidate_B')),'GET','invalid or duplicate']);
cases.push([changed(rank,u=>u.searchParams.set('take','100')),'GET','take']);
cases.push([changed(rank,u=>u.searchParams.set('filter.tags',tags.sitar)),'GET','query keys']);
cases.push([changed(rank,u=>u.hash='#secret'),'GET','origin']);
cases.push([changed(rank,u=>u.username='evil'),'GET','origin']);
let passed=0;
for(const [u,kind] of valid){assert.equal(classifyQlooRequest(u,'GET',ctx).kind,kind);passed++;}
for(const [u,method,expected] of cases){
 assert.throws(()=>classifyQlooRequest(u,method,ctx),e=>e.message.includes('QLOO_MOCK_DENIED')&&e.message.includes(expected));passed++;
}
console.log(`PASS ${passed}/${passed}: ${valid.length} legitimate actual-Worker-shaped Qloo requests, ${cases.length} malformed/malicious requests rejected.`);
