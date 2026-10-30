// CultureShift Guardian v3.9.2 — source-anchored, OFFLINE-ONLY Qloo mock.
// This validator models the EXACT query contract in the supplied worker/index.js.
// No network calls, real Qloo claims, or origin attestation are made.
const ORIGIN = 'https://hackathon.api.qloo.com';
const PATH = '/v2/insights';
const BASE_KEYS = new Set(['filter.type', 'filter.results.entities', 'take', 'signal.interests.entities']);
const TAG_KEYS = new Set(['filter.tags', 'operator.filter.tags']);
function lower(x) { return String(x).trim().toLowerCase(); }
function exactSet(actual, expected) {
  if (actual.length !== expected.length || new Set(actual).size !== actual.length || new Set(expected).size !== expected.length) return false;
  const lookup = new Set(expected);
  return actual.every(x => lookup.has(x));
}
function splitIds(value) {
  return value.split(',').map(lower).filter(Boolean);
}
function assertExactKeys(url, keys) {
  const actual = [...url.searchParams.keys()];
  if (!exactSet(actual, [...keys])) throw new Error(`QLOO_MOCK_DENIED: query keys mismatch [${actual}] expected [${[...keys]}]`);
}
/**
 * @param {string|URL} input
 * @param {string} method
 * @param {{candidateIds:string[], audienceSignal:string, preserveTags:Record<string,string>, expectedRankingIds?:string[]}} ctx
 */
export function classifyQlooRequest(input, method, ctx) {
  const url = input instanceof URL ? input : new URL(input);
  if (url.origin !== ORIGIN || url.username || url.password || url.hash || url.port) {
    throw new Error(`QLOO_MOCK_DENIED: unexpected origin or URL structure ${url.origin}${url.pathname}`);
  }
  if (url.pathname !== PATH || method !== 'GET') {
    throw new Error(`QLOO_MOCK_DENIED: only GET ${PATH} accepted`);
  }
  if (url.searchParams.get('filter.type') !== 'urn:entity:artist') {
    throw new Error('QLOO_MOCK_DENIED: incorrect filter.type');
  }
  if (url.searchParams.get('signal.interests.entities') !== ctx.audienceSignal) {
    throw new Error('QLOO_MOCK_DENIED: unexpected audience signal');
  }
  const rawIds = url.searchParams.get('filter.results.entities');
  if (!rawIds) throw new Error('QLOO_MOCK_DENIED: missing candidate IDs');
  const ids = splitIds(rawIds);
  if (!ids.length || ids.length !== rawIds.split(',').length || new Set(ids).size !== ids.length) {
    throw new Error('QLOO_MOCK_DENIED: invalid or duplicate candidate IDs');
  }
  if (url.searchParams.get('take') !== String(ids.length)) {
    throw new Error('QLOO_MOCK_DENIED: take must equal number of candidate IDs');
  }
  if (url.searchParams.has('filter.tags') || url.searchParams.has('operator.filter.tags')) {
    assertExactKeys(url, new Set([...BASE_KEYS, ...TAG_KEYS]));
    if (url.searchParams.get('operator.filter.tags') !== 'union') {
      throw new Error('QLOO_MOCK_DENIED: tag operator must be union (single tag)');
    }
    const rawTag = url.searchParams.get('filter.tags');
    const match = Object.entries(ctx.preserveTags).find(([_, tag]) => tag === rawTag);
    if (!match) throw new Error('QLOO_MOCK_DENIED: unexpected constraint tag');
    if (!exactSet(ids, ctx.candidateIds.map(lower))) {
      throw new Error('QLOO_MOCK_DENIED: constraint candidate set changed');
    }
    return {kind:'constraint', tag:match[0], ids};
  }
  assertExactKeys(url, BASE_KEYS);
  if (!exactSet(ids, (ctx.expectedRankingIds||[]).map(lower))) {
    throw new Error('QLOO_MOCK_DENIED: rank set is not exact minimum-scope survivor set');
  }
  return {kind:'ranking', ids};
}
export function offlineQlooResponse(ids, role = 'fixture') {
  const entities = ids.map((id, index) => ({
    id, entity_id:id, name:`Offline ${role} ${id}`, type:'urn:entity:artist', subtype:'urn:entity:artist',
    popularity:Number((0.8-index*0.03).toFixed(4)),
    affinity:Number((0.9-index*0.06).toFixed(4)),
  }));
  return new Response(JSON.stringify({results:{entities}}), {status:200, headers:{'content-type':'application/json'}});
}
