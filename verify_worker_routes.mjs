// verify_worker_routes.mjs
// Guardian v3.9 Integrated Worker Route Regression Suite (MOCKED QLOO ONLY — FAIL-CLOSED NETWORK ISOLATION).
// Verifies:
// - Route 1: GET /health (0 outbound network calls allowed)
// - Route 2: POST /api/interventions (0 outbound network calls allowed)
// - Route 3: POST /api/evaluate spoof rejection with valid audience="bts" (0 outbound network calls allowed)
// - Route 4: POST /api/evaluate Query-Aware Hard-AND Intersection (distinct allowlists per tag; proves true intersection & exclusion)
// - Route 5: POST /api/evaluate Query-Aware Disjoint Allowlists -> Empty Intersection safe DO_NOT_CHANGE refusal
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyQlooRequest, offlineQlooResponse } from './strict_qloo_mock.mjs';

async function loadIntegratedWorkerAsEsm() {
  const indexPath = path.resolve('./worker/index.js');
  const proofUrl = pathToFileURL(path.resolve('./worker/proof.mjs')).href;
  const rawSource = fs.readFileSync(indexPath, 'utf8');

  if (!rawSource.includes('./proof.mjs')) {
    throw new Error(
      'worker/index.js does not yet import ./proof.mjs. Run `node build_safe_release_patch.mjs --apply-working-tree` or test inside a patched disposable worktree.'
    );
  }

  const rewrittenSource = rawSource.replace(
    /from\s+['"]\.\/proof\.mjs['"]/g,
    `from '${proofUrl}'`
  );

  const dataUrl =
    'data:text/javascript;base64,' + Buffer.from(rewrittenSource, 'utf8').toString('base64');
  const mod = await import(dataUrl);
  return { worker: mod.default, rawSource };
}

/**
 * Extracts CANDIDATES objects ({ id, scope/interventionScope }) from worker/index.js source.
 * @param {string} sourceText
 * @returns {Array<{ id: string; scope: number | null }>}
 */
function extractCandidatesFromWorkerSource(sourceText) {
  const candidatesBlockMatch = sourceText.match(/const\s+CANDIDATES\s*=\s*\[([\s\S]*?)\];/);
  const region = candidatesBlockMatch ? candidatesBlockMatch[1] : sourceText;
  const objectBlocks = region.match(/\{[\s\S]*?\}/g) || [];
  /** @type {Array<{ id: string; scope: number | null }>} */
  const parsed = [];
  const seen = new Set();

  for (const block of objectBlocks) {
    const idMatch = block.match(/\bid\s*:\s*['"]([^'"]+)['"]/);
    if (!idMatch) continue;
    const id = idMatch[1];
    if (seen.has(id)) continue;
    seen.add(id);

    const scopeMatch = block.match(/\b(?:scope|interventionScope)\s*:\s*(\d+)/);
    const scope = scopeMatch ? Number(scopeMatch[1]) : null;
    parsed.push({ id, scope });
  }
  return parsed;
}

/**
 * Fail-closed network isolation wrapper.
 * Installs a global fetch interceptor before executing `testFn`.
 * If `mockHandler` is null, ANY outbound fetch immediately throws an unexpected network call error.
 *
 * @template T
 * @param {((url: URL, method: string, init?: RequestInit) => Promise<Response> | Response) | null} mockHandler
 * @param {(recordedCalls: Array<{ url: string; method: string }>) => Promise<T>} testFn
 * @returns {Promise<T>}
 */
async function withFailClosedFetch(mockHandler, testFn) {
  const originalFetch = globalThis.fetch;
  /** @type {Array<{ url: string; method: string }>} */
  const recordedCalls = [];

  globalThis.fetch = async (input, init) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method || (typeof input === 'object' && 'method' in input ? input.method : 'GET') || 'GET';
    recordedCalls.push({ url: urlStr, method });

    if (!mockHandler) {
      throw new Error(
        `NETWORK ISOLATION VIOLATION: Unexpected outbound fetch(${method} ${urlStr}) during route test that forbids network calls.`
      );
    }

    const parsedUrl = new URL(urlStr);
    return await mockHandler(parsedUrl, method.toUpperCase(), init);
  };

  try {
    return await testFn(recordedCalls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runIntegratedRouteRegressions() {
  const { worker, rawSource } = await loadIntegratedWorkerAsEsm();
  assert.equal(typeof worker?.fetch, 'function', 'worker.fetch must be a function');

  const testEnv = {
    QLOO_API_KEY: 'mock-key-offline-isolation-test',
  };

  // =========================================================================
  // ROUTE 1: GET /health (Fail-closed fetch: 0 outbound requests allowed)
  // =========================================================================
  await withFailClosedFetch(null, async (calls) => {
    const req = new Request('https://cultureshift-ai.workers.dev/health', { method: 'GET' });
    const res = await worker.fetch(req, testEnv, {});
    assert.equal(res.status, 200, 'GET /health must return HTTP 200');
    const body = await res.json();
    assert.equal(typeof body, 'object');
    assert.ok(
      body.status === 'ok' || body.ok === true || 'service' in body,
      'GET /health must return valid status payload'
    );
    assert.equal(calls.length, 0, 'GET /health must make 0 outbound network requests');
    console.log('[PASS] Route 1 (ISOLATED, 0 network calls): GET /health -> HTTP 200');
  });

  // =========================================================================
  // ROUTE 2: POST /api/interventions (Fail-closed fetch: 0 outbound requests allowed)
  // =========================================================================
  await withFailClosedFetch(null, async (calls) => {
    const req = new Request('https://cultureshift-ai.workers.dev/api/interventions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audience: 'bts',
        preserve: ['sitar', 'classical'],
      }),
    });
    const res = await worker.fetch(req, testEnv, {});
    assert.equal(res.status, 200, 'POST /api/interventions must return HTTP 200');
    const body = await res.json();
    assert.equal(typeof body, 'object');
    assert.equal(calls.length, 0, 'POST /api/interventions must make 0 outbound network requests');
    console.log('[PASS] Route 2 (ISOLATED, 0 network calls): POST /api/interventions -> HTTP 200');
  });

  // =========================================================================
  // ROUTE 3: POST /api/evaluate Spoof Guard (Fail-closed fetch: 0 outbound requests allowed)
  // =========================================================================
  await withFailClosedFetch(null, async (calls) => {
    const req = new Request('https://cultureshift-ai.workers.dev/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audience: 'bts',
        preserve: ['sitar'],
        decision_proof: { forged: true },
      }),
    });
    const res = await worker.fetch(req, testEnv, {});
    assert.equal(res.status, 400, 'Spoofed decision_proof must return HTTP 400');
    const errBody = await res.json();
    assert.match(
      String(errBody.error),
      /Rejected caller-supplied authoritative pipeline field:\s*"decision_proof"/,
      `Expected exact spoof guard rejection, received: ${errBody.error}`
    );
    assert.equal(calls.length, 0, 'Spoofed request must be blocked BEFORE any outbound Qloo network call');
    console.log(
      '[PASS] Route 3 (ISOLATED, 0 network calls): POST /api/evaluate rejects forged decision_proof before any Qloo call'
    );
  });

  // ROUTE 4: Test constraint intersection and minimum-scope before ranking.
  // Real catalog is checked without inventing scope values. Mixed scopes are
  // tested separately in a TEST-ONLY in-memory mutation of the authentic Worker.
  const catalog = extractCandidatesFromWorkerSource(rawSource);
  assert.ok(catalog.length >= 3, 'Need >=3 distinct catalog candidates to test true Hard-AND exclusion');
  assert.ok(catalog.every(c => Number.isInteger(c.scope) && c.scope >= 0 && c.scope <= 3),
    'Every candidate in the test must have a known integer scope 0..3; do not invent scope values');
  const allIds = catalog.map(c => c.id);
  // The real Worker has full URN strings, not shorthand `sitar` or `classical`.
  // Extract exact source literals so mocked requests enforce real query contracts.
  const sitarURN = rawSource.match(/sitar:\s*["']([^"']+)["']/)?.[1];
  const classicalURN = rawSource.match(/classical:\s*["']([^"']+)["']/)?.[1];
  const btsAudience = rawSource.match(/bts:\s*["']([^"']+)["']/)?.[1];
  assert.ok(sitarURN && classicalURN && btsAudience, 'Real Worker must declare known Qloo tags and audience IDs');
  const requestContext = {
    candidateIds: allIds,
    audienceSignal: btsAudience,
    preserveTags: { sitar: sitarURN, classical: classicalURN },
  };
  const onlySitarId = allIds[0];
  const onlyClassicalId = allIds[allIds.length - 1];
  const intersectionCatalog = catalog.slice(1, Math.min(catalog.length - 1, 3));
  assert.ok(intersectionCatalog.length >= 1, 'Must have >=1 candidate in strict intersection');
  const intersectedIds = intersectionCatalog.map(c => c.id);
  const minScope = Math.min(...intersectionCatalog.map(c => c.scope));
  const expectedMinimumScopeIds = intersectionCatalog.filter(c => c.scope === minScope).map(c => c.id);
  const mixedScope = intersectionCatalog.some(c => c.scope !== minScope);
  const sitarAllowlist = [onlySitarId, ...intersectedIds];
  const classicalAllowlist = [...intersectedIds, onlyClassicalId];
  const normalizeTag = x => x === sitarURN ? 'sitar' : x === classicalURN ? 'classical' : `unexpected:${x}`;
  const sortedLower = xs => xs.map(x => String(x).toLowerCase()).sort();

  await withFailClosedFetch(
    (url, method) => {
      const identified = classifyQlooRequest(url, method, {
        ...requestContext,
        expectedRankingIds: expectedMinimumScopeIds,
      });
      if (identified.kind === 'constraint') {
        return offlineQlooResponse(
          identified.tag === 'sitar' ? sitarAllowlist : classicalAllowlist,
          `${identified.tag} constraint`
        );
      }
      return offlineQlooResponse(identified.ids, 'minimum-scope ranking');
    },
    async calls => {
      const req = new Request('https://cultureshift-ai.workers.dev/api/evaluate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audience: 'bts', preserve: ['sitar', 'classical'] }),
      });
      const res = await worker.fetch(req, testEnv, {});
      assert.equal(res.status, 200, 'Hard-AND route must return HTTP 200');
      const data = await res.json();
      assert.equal(data.decision, 'BRIDGE_FOUND');
      assert.equal(calls.length, 3, 'Expected 2 constraint fetches and 1 ranking fetch');
      assert.deepEqual(sortedLower(data.candidatesConsidered), sortedLower(expectedMinimumScopeIds),
        'Only intersection candidates at minimum feasible scope can reach ranking');
      assert.equal(data.interventionScope, minScope,
        'Intervention scope must be the minimum scope among the true Hard-AND intersection');
      const ev = data.constraintEvidence;
      assert.ok(Array.isArray(ev));
      const sitar = ev.find(e => normalizeTag(e.constraint) === 'sitar');
      const classical = ev.find(e => normalizeTag(e.constraint) === 'classical');
      assert.ok(sitar && classical, 'Both independent constraint calls must produce proof evidence');
      assert.deepEqual(sortedLower(sitar.allowed), sortedLower(sitarAllowlist));
      assert.deepEqual(sortedLower(classical.allowed), sortedLower(classicalAllowlist));
      const rankedIds = data.ranking.results.map(x => x.entity_id);
      assert.deepEqual(sortedLower(rankedIds), sortedLower(expectedMinimumScopeIds),
        'Ranked IDs must be exactly the minimum-scope intersection');
      for (const excluded of [onlySitarId, onlyClassicalId]) {
        assert.ok(!data.candidatesConsidered.includes(excluded), `Candidate ${excluded} must be excluded`);
        assert.ok(!rankedIds.includes(excluded), `Candidate ${excluded} must not be ranked`);
      }
      assert.equal(data.decision_proof.proof_version, '3.9.0-strict-explicit-options');
      assert.equal(data.decision_proof.proof_integrity_status, 'VERIFIED_PROTECTED_BRIDGE');
      assert.deepEqual(
        sortedLower(data.decision_proof.constraint_evidence_summary.intersected_entity_ids),
        sortedLower(intersectedIds), 'Decision Proof must record the full intersection');
      assert.ok(expectedMinimumScopeIds.some(id => id.toLowerCase() === data.decision_proof.selected_candidate.entity_id.toLowerCase()));
      console.log(`[PASS] Route 4: exact hard-AND [${intersectedIds}], min scope ${minScope} [${expectedMinimumScopeIds}], ` +
        `${calls.length} strictly validated offline Qloo requests; mixed scopes=${mixedScope}`);
    }
  );

  // ROUTE 5: Incompatible allowlists must refuse WITHOUT Qloo ranking.
  await withFailClosedFetch(
    (url, method) => {
      const identified = classifyQlooRequest(url, method, {
        ...requestContext, expectedRankingIds: [],
      });
      if (identified.kind !== 'constraint') throw new Error('Ranking forbidden on empty intersection');
      return offlineQlooResponse(
        identified.tag === 'sitar' ? [allIds[0]] : [allIds[1]],
        `${identified.tag} empty-intersection constraint`
      );
    },
    async calls => {
      const req = new Request('https://cultureshift-ai.workers.dev/api/evaluate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audience: 'bts', preserve: ['sitar', 'classical'] }),
      });
      const res = await worker.fetch(req, testEnv, {});
      assert.equal(res.status, 200, 'Empty-intersection refusal must return HTTP 200');
      const data = await res.json();
      assert.equal(calls.length, 2, 'Empty intersection must never send a Qloo ranking request');
      assert.equal(data.decision, 'DO_NOT_CHANGE');
      assert.equal(data.decision_proof.pipeline_decision, 'DO_NOT_CHANGE');
      assert.equal(data.decision_proof.proof_integrity_status, 'CONSISTENT_REFUSAL');
      assert.equal(data.decision_proof.constraint_evidence_summary.intersected_allowed_count, 0);
      assert.equal(data.decision_proof.selected_candidate, null);
      console.log(`[PASS] Route 5: strict-host/path/query mocked empty intersection → safe refusal; ${calls.length} requests`);
    }
  );
  console.log('\nALL 5 INTEGRATED WORKER ROUTE TESTS PASSED (OFFLINE MOCK ONLY).');
}
runIntegratedRouteRegressions().catch(err => { console.error(err); process.exit(1); });
