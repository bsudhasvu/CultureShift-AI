// verify_v39_all.mjs
// Itemized 46-check verification suite: 42 historical checks + 4 new v3.9 fallback-removal checks (V39_1 - V39_4)
import assert from 'node:assert/strict';
import {
  assertNoSpoofedEvaluationFields,
  buildDecisionProofFromRunResult,
} from './worker/proof.mjs';

async function runItemized46Suite() {
  let passed = 0;
  function markPass(label) {
    passed++;
    console.log(`[PASS ${String(passed).padStart(2, '0')}/46] ${label}`);
  }

  const stdOpts = (tags = ['sitar'], aud = ['bts']) => ({
    requestedPreserveTags: tags,
    audienceSignals: aud,
    qlooEndpoint: '/v2/insights',
    comparisonContext: 'single_shared_audience_query_over_minimum_scope_survivors',
  });

  // 1. T01
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['cand_missing_second_tag'],
        constraintEvidence: [
          { constraint: 'urn:tag:sitar', allowed: ['cand_missing_second_tag', 'cand_other'] },
          { constraint: 'urn:tag:classical', allowed: ['cand_other'] },
        ],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'cand_missing_second_tag', name: 'Inconsistent', popularity: 0.5, affinity: 0.85 }],
        },
      },
      stdOpts(['urn:tag:sitar', 'urn:tag:classical'])
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    assert.equal(res.selected_candidate, null);
    markPass('T01: Candidate missing one required tag fails closed');
  }

  // 2. T02
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['cand_valid_1', 'cand_valid_2'],
        constraintEvidence: [
          { constraint: 'urn:tag:sitar', allowed: ['cand_valid_1', 'cand_valid_2'] },
          { constraint: 'urn:tag:raga', allowed: ['cand_valid_1', 'cand_valid_2'] },
        ],
        ranking: {
          status: 'ok',
          result_count: 2,
          results: [
            { entity_id: 'cand_valid_1', name: 'Valid 1', popularity: 0.72, affinity: 0.88 },
            { entity_id: 'cand_valid_2', name: 'Valid 2', popularity: 0.64, affinity: 0.79 },
          ],
        },
      },
      stdOpts(['urn:tag:sitar', 'urn:tag:raga'])
    );
    assert.equal(res.proof_integrity_status, 'VERIFIED_PROTECTED_BRIDGE');
    markPass('T02: Valid two-tag Worker-shaped evidence decoded accurately');
  }

  // 3. T03
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['cand_valid_1', 'cand_valid_2'],
        constraintEvidence: [{ constraint: 'urn:tag:sitar', allowed: ['cand_valid_1', 'cand_valid_2'] }],
        ranking: {
          status: 'ok',
          result_count: 2,
          results: [
            { entity_id: 'cand_valid_1', name: 'Valid 1', popularity: 0.72, affinity: 0.88 },
            { entity_id: 'cand_valid_2', name: 'Valid 2', popularity: 0.64, affinity: 0.79 },
          ],
        },
      },
      stdOpts(['urn:tag:sitar'])
    );
    assert.equal(res.candidates_considered_audit[0].entity_id, 'cand_valid_1');
    assert.equal(res.candidates_considered_audit[0].disposition, 'SELECTED_TOP_RANKED_IN_MINIMUM_SCOPE');
    markPass('T03: String array candidatesConsidered preserves string IDs and dispositions');
  }

  // 4. T04
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 0,
        candidatesConsidered: ['cand_unprotected'],
        constraintEvidence: [],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'cand_unprotected', name: 'Unprotected', popularity: 0.5, affinity: 0.75 }],
        },
      },
      stdOpts([])
    );
    assert.equal(res.constraints_requested, false);
    assert.equal(res.selected_candidate.identity_protected, false);
    assert.equal(res.proof_integrity_status, 'UNPROTECTED_BRIDGE_NO_CONSTRAINTS_REQUESTED');
    markPass('T04: Empty constraintEvidence=[] with requestedPreserveTags=[] marked unprotected');
  }

  // 5. T05
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['cand_in_scope'],
        constraintEvidence: [{ constraint: 'urn:tag:sitar', allowed: ['cand_in_scope', 'rogue'] }],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'rogue', name: 'Rogue', popularity: 0.8, affinity: 0.95 }],
        },
      },
      stdOpts(['urn:tag:sitar'])
    );
    assert.equal(res.selected_candidate, null);
    assert.equal(res.minimum_scope_ranking.ranking_executed, false);
    markPass('T05: Ranked entity outside candidatesConsidered rejected');
  }

  // 6. T06
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['cand_bad_score'],
        constraintEvidence: [{ constraint: 'urn:tag:sitar', allowed: ['cand_bad_score'] }],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'cand_bad_score', name: 'Bad', popularity: 0.5, affinity: 1.7 }],
        },
      },
      stdOpts(['urn:tag:sitar'])
    );
    assert.equal(res.minimum_scope_ranking.ranking_executed, false);
    assert.equal(res.selected_candidate, null);
    markPass('T06: Invalid affinity 1.7 rejected');
  }

  // 7. T07
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['cand_1'],
        constraintEvidence: { byTag: [{ constraint: 'urn:tag:sitar', allowed: ['cand_1'] }] },
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'cand_1', name: 'C1', popularity: 0.5, affinity: 0.8 }],
        },
      },
      stdOpts(['urn:tag:sitar'])
    );
    assert.equal(res.constraint_evidence_summary.per_tag_allowed_counts[0].allowed_entity_count, 1);
    markPass('T07: Nested byTag wrapper with { constraint, allowed } decoded');
  }

  // 8. T08
  {
    assert.equal(assertNoSpoofedEvaluationFields({ ranking: {} }).ok, false);
    markPass('T08: Top-level forged ranking field rejected');
  }

  // 9. T09
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'DO_NOT_CHANGE',
        reason: 'Empty intersection',
        constraintEvidence: [
          { constraint: 'urn:tag:sitar', allowed: ['a'] },
          { constraint: 'urn:tag:kpop', allowed: ['b'] },
        ],
      },
      stdOpts(['urn:tag:sitar', 'urn:tag:kpop'])
    );
    assert.equal(res.proof_integrity_status, 'CONSISTENT_REFUSAL');
    markPass('T09: DO_NOT_CHANGE preserves constraintEvidence');
  }

  // 10. T10
  {
    const p1 = await buildDecisionProofFromRunResult(
      {
        decision: 'DO_NOT_CHANGE',
        reason: 'Empty intersection',
        constraintEvidence: [{ constraint: 'urn:tag:sitar', allowed: [] }],
      },
      stdOpts(['urn:tag:sitar'])
    );
    const p2 = await buildDecisionProofFromRunResult(
      {
        decision: 'DO_NOT_CHANGE',
        reason: 'Empty intersection',
        constraintEvidence: [{ constraint: 'urn:tag:sitar', allowed: [] }],
      },
      stdOpts(['urn:tag:sitar'])
    );
    assert.equal(p1.receipt_payload_sha256, p2.receipt_payload_sha256);
    markPass('T10: Deterministic SHA-256 digest');
  }

  // 11. Case A
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1'],
        constraintEvidence: [
          { constraint: 'sitar', allowed: ['c1'] },
          { constraint: 'classical', allowed: ['c1'] },
        ],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      stdOpts(['sitar', 'classical'])
    );
    assert.equal(res.proof_integrity_status, 'VERIFIED_PROTECTED_BRIDGE');
    markPass('Case A: Valid 2-constraint fixture -> VERIFIED_PROTECTED_BRIDGE');
  }

  // 12. Case B
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1'] }],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      stdOpts(['sitar', 'classical'])
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('Case B: Omitted required constraint detected via requestedPreserveTags');
  }

  // 13. Case C
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1'],
        constraintEvidence: {},
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      stdOpts([])
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('Case C: Malformed constraintEvidence={} fails closed');
  }

  // 14. Case D
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 99,
        candidatesConsidered: ['c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1'] }],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      stdOpts(['sitar'])
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('Case D: Invalid interventionScope=99 fails closed');
  }

  // 15. Case E
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1', 'c2_violator'],
        constraintEvidence: [
          { constraint: 'sitar', allowed: ['c1', 'c2_violator'] },
          { constraint: 'classical', allowed: ['c1'] },
        ],
        ranking: {
          status: 'ok',
          result_count: 2,
          results: [
            { entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 },
            { entity_id: 'c2_violator', name: 'C2', popularity: 0.5, affinity: 0.75 },
          ],
        },
      },
      stdOpts(['sitar', 'classical'])
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('Case E: Runner-up violating constraint fails closed');
  }

  // 16. Case F
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1', 'c2'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1', 'c2'] }],
        ranking: {
          status: 'ok',
          result_count: 2,
          results: [
            { entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.60 },
            { entity_id: 'c2', name: 'C2', popularity: 0.6, affinity: 0.97 },
          ],
        },
      },
      stdOpts(['sitar'])
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('Case F: Inverted affinity order [0.60, 0.97] fails closed');
  }

  // 17. Case G
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1', null, 123] }],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      stdOpts(['sitar'])
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('Case G: Non-string allowed IDs rejected');
  }

  // 18. Case H
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1'],
        constraintEvidence: [],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      stdOpts([])
    );
    assert.equal(res.proof_integrity_status, 'UNPROTECTED_BRIDGE_NO_CONSTRAINTS_REQUESTED');
    markPass('Case H: Explicit empty constraints marked unprotected');
  }

  // 19. Case I
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1'] }],
        ranking: { status: 'ok', result_count: 0, results: [] },
      },
      stdOpts(['sitar'])
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('Case I: Empty ranking under BRIDGE_FOUND fails closed');
  }

  // 20. Case J
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: 'c1' }],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      stdOpts(['sitar'])
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('Case J: Malformed allowed string fails closed');
  }

  // 21. Probe 1
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1'] }],
        ranking: {
          status: 'error',
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      stdOpts(['sitar'])
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('Probe 1: ranking.status="error" fails closed');
  }

  // 22. Probe 2
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1', 'c2'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1', 'c2'] }],
        ranking: {
          status: 'ok',
          result_count: 999,
          results: [
            { entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 },
            { entity_id: 'c2', name: 'C2', popularity: 0.5, affinity: 0.75 },
          ],
        },
      },
      stdOpts(['sitar'])
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('Probe 2: Mismatched ranking.result_count=999 fails closed');
  }

  // 23. Probe 3
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['a', 'b'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['a', 'b'] }],
        ranking: {
          status: 'ok',
          result_count: 2,
          results: [
            { entity_id: 'a', name: 'A', popularity: 0.6, affinity: 0.85 },
            { entity_id: 'a', name: 'A dup', popularity: 0.6, affinity: 0.80 },
          ],
        },
      },
      stdOpts(['sitar'])
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('Probe 3: Duplicate ranking.results entity IDs ["a", "a"] rejected');
  }

  // 24. Probe 4
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'DO_NOT_CHANGE',
        reason: 'Refused',
        constraintEvidence: [
          { constraint: 'sitar', allowed: ['c1'] },
          { constraint: 'classical', allowed: ['c1'] },
        ],
      },
      stdOpts(['sitar', 'classical'])
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('Probe 4: Inconsistent DO_NOT_CHANGE with non-empty intersection flagged');
  }

  // 25. Probe 5
  {
    const baseRun = {
      decision: 'BRIDGE_FOUND',
      interventionScope: 1,
      candidatesConsidered: ['c1'],
      constraintEvidence: [{ constraint: 'sitar', allowed: ['c1'] }],
      ranking: {
        status: 'ok',
        result_count: 1,
        results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
      },
    };
    const pA = await buildDecisionProofFromRunResult(baseRun, stdOpts(['sitar'], ['urn:audience:bts_army']));
    const pB = await buildDecisionProofFromRunResult(baseRun, stdOpts(['sitar'], ['urn:audience:indie_folk']));
    assert.notEqual(pA.receipt_payload_sha256, pB.receipt_payload_sha256);
    markPass('Probe 5: Distinct audienceSignals produce distinct SHA-256 digests');
  }

  // 26. Probe 6
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1', 'c1'] }],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      stdOpts(['sitar'])
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('Probe 6: Duplicate IDs inside allowed[] rejected');
  }

  // 27. Probe 7
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1', 'c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1'] }],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      stdOpts(['sitar'])
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('Probe 7: Duplicate IDs in candidatesConsidered rejected');
  }

  // 28. Probe 8
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1', 'c2'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1', 'c2'] }],
        ranking: {
          status: 'ok',
          ok: true,
          result_count: 2,
          results: [
            { entity_id: 'c1', name: 'C1', popularity: 0.7, affinity: 0.9 },
            { entity_id: 'c2', name: 'C2', popularity: 0.6, affinity: 0.8 },
          ],
        },
      },
      stdOpts(['sitar'])
    );
    assert.equal(res.proof_integrity_status, 'VERIFIED_PROTECTED_BRIDGE');
    markPass('Probe 8: Positive control with full ranking metadata passes');
  }

  // 29. Probe 9
  {
    assert.equal(assertNoSpoofedEvaluationFields({ decision_proof: {} }).ok, false);
    markPass('Probe 9: Spoofed decision_proof field rejected');
  }

  // 30. V35_1
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1'] }],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      {
        requestedPreserveTags: ['sitar'],
        qlooEndpoint: '/v2/insights',
        comparisonContext: 'single_shared_audience_query_over_minimum_scope_survivors',
      }
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('V35_1: Omitted/unbound audienceSignals fails closed');
  }

  // 31. V35_2
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1'] }],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      {
        audienceSignals: ['bts'],
        qlooEndpoint: '/v2/insights',
        comparisonContext: 'single_shared_audience_query_over_minimum_scope_survivors',
      }
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('V35_2: Omitted authoritative requestedPreserveTags fails closed');
  }

  // 32. V35_3
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1'] }],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      {
        requestedPreserveTags: ['sitar'],
        audienceSignals: ['bts'],
        qlooEndpoint: 'https://not-qloo.invalid/fake',
        comparisonContext: 'single_shared_audience_query_over_minimum_scope_survivors',
      }
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('V35_3: Arbitrary qlooEndpoint rejected');
  }

  // 33. V35_4
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1'] }],
        ranking: {
          status: 'ok',
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      stdOpts(['sitar'])
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('V35_4: Omitted ranking.result_count rejected');
  }

  // 34. V35_5
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1'] }],
        ranking: {
          status: 'ok',
          ok: 0,
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      stdOpts(['sitar'])
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('V35_5: ranking.ok=0 rejected');
  }

  // 35. V35_6
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1'] }],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      {
        requestedPreserveTags: ['sitar'],
        audienceSignals: ['bts'],
        qlooEndpoint: '/v2/insights',
        comparisonContext: 'multi_query_uncomparable_context',
      }
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('V35_6: Arbitrary comparisonContext rejected');
  }

  // 36. V36_1
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'SOME_UNKNOWN_OUTCOME',
        constraintEvidence: [],
      },
      stdOpts([])
    );
    assert.equal(res.proof_integrity_status, 'INVALID_PIPELINE_DECISION');
    markPass('V36_1: Unknown decision marked INVALID_PIPELINE_DECISION');
  }

  // 37. V36_2
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1'] }],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 99, affinity: 0.85 }],
        },
      },
      stdOpts(['sitar'])
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('V36_2: Out-of-range popularity: 99 flagged and fails closed');
  }

  // 38. V36_3
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1'] }],
        ranking: {
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      stdOpts(['sitar'])
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('V36_3: Missing ranking.status under BRIDGE_FOUND rejected');
  }

  // 39. V36_4
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1'] }],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      stdOpts(['sitar'])
    );
    assert.equal(
      res.query_and_audience_context.provenance_attestation_level,
      'CONFIGURED_SERVER_PIPELINE_LABEL_NOT_CRYPTOGRAPHIC_UPSTREAM_SIGNATURE'
    );
    markPass('V36_4: Configured endpoint label distinguished from upstream signature');
  }

  // 40. V36_5
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1'] }],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: null, affinity: 0.85 }],
        },
      },
      stdOpts(['sitar'])
    );
    assert.equal(res.proof_integrity_status, 'VERIFIED_PROTECTED_BRIDGE');
    markPass('V36_5: Null popularity accepted when affinity and status="ok" are valid');
  }

  // 41. V37_P1
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1'] }],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      {
        requestedPreserveTags: ['sitar'],
        audienceSignals: ['bts'],
        comparisonContext: 'single_shared_audience_query_over_minimum_scope_survivors',
      }
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    assert.equal(res.query_and_audience_context.endpoint_label_explicitly_passed, false);
    assert.equal(res.selected_candidate, null);
    markPass('V37_P1: Omitted qlooEndpoint fails closed');
  }

  // 42. V37_P2
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1'] }],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      {
        requestedPreserveTags: ['sitar'],
        audienceSignals: ['bts'],
        qlooEndpoint: '/v2/insights',
      }
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    assert.equal(res.query_and_audience_context.comparison_context_explicitly_passed, false);
    assert.equal(res.selected_candidate, null);
    markPass('V37_P2: Omitted comparisonContext fails closed');
  }

  // --- SECTION 7: New V3.9 Fallback-Removal Negative Checks (V39_1 - V39_4) ---
  // 43. V39_1: Supplying runResult.requestedPreserveTags / runResult.preserveTags while omitting options.requestedPreserveTags MUST fail closed
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        requestedPreserveTags: ['sitar'],
        preserveTags: ['sitar'],
        candidatesConsidered: ['c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1'] }],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      {
        // requestedPreserveTags intentionally omitted from options!
        audienceSignals: ['bts'],
        qlooEndpoint: '/v2/insights',
        comparisonContext: 'single_shared_audience_query_over_minimum_scope_survivors',
      }
    );
    assert.equal(
      res.proof_integrity_status,
      'CANDIDATE_OR_CONSTRAINT_MISMATCH',
      'V39_1: runResult.requestedPreserveTags/preserveTags must NOT substitute for options.requestedPreserveTags'
    );
    assert.equal(res.query_and_audience_context.requested_preserve_tags_bound, false);
    assert.equal(res.selected_candidate, null);
    markPass('V39_1: Fallback to runResult.requestedPreserveTags / runResult.preserveTags blocked');
  }

  // 44. V39_2: Supplying runResult.audienceSignals / runResult.audienceSignal while omitting options.audienceSignals MUST fail closed
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        audienceSignals: ['bts'],
        audienceSignal: 'bts',
        candidatesConsidered: ['c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1'] }],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      {
        requestedPreserveTags: ['sitar'],
        // audienceSignals intentionally omitted from options!
        qlooEndpoint: '/v2/insights',
        comparisonContext: 'single_shared_audience_query_over_minimum_scope_survivors',
      }
    );
    assert.equal(
      res.proof_integrity_status,
      'CANDIDATE_OR_CONSTRAINT_MISMATCH',
      'V39_2: runResult.audienceSignals/audienceSignal must NOT substitute for options.audienceSignals'
    );
    assert.equal(res.query_and_audience_context.audience_context_bound, false);
    assert.equal(res.selected_candidate, null);
    markPass('V39_2: Fallback to runResult.audienceSignals / runResult.audienceSignal blocked');
  }

  // 45. V39_3: Supplying legacy singular options.audienceSignal while omitting options.audienceSignals MUST fail closed
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'BRIDGE_FOUND',
        interventionScope: 1,
        candidatesConsidered: ['c1'],
        constraintEvidence: [{ constraint: 'sitar', allowed: ['c1'] }],
        ranking: {
          status: 'ok',
          result_count: 1,
          results: [{ entity_id: 'c1', name: 'C1', popularity: 0.6, affinity: 0.85 }],
        },
      },
      /** @type {any} */ ({
        requestedPreserveTags: ['sitar'],
        audienceSignal: 'bts', // singular fallback removed; must use options.audienceSignals
        qlooEndpoint: '/v2/insights',
        comparisonContext: 'single_shared_audience_query_over_minimum_scope_survivors',
      })
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    assert.equal(res.query_and_audience_context.audience_context_bound, false);
    assert.equal(res.selected_candidate, null);
    markPass('V39_3: Singular options.audienceSignal fallback blocked; options.audienceSignals required');
  }

  // 46. V39_4: DO_NOT_CHANGE also fails closed if explicit options.requestedPreserveTags or options.audienceSignals is omitted
  {
    const res = await buildDecisionProofFromRunResult(
      {
        decision: 'DO_NOT_CHANGE',
        reason: 'Empty intersection',
        requestedPreserveTags: ['sitar'],
        audienceSignals: ['bts'],
        constraintEvidence: [{ constraint: 'sitar', allowed: [] }],
      },
      {
        qlooEndpoint: '/v2/insights',
        comparisonContext: 'single_shared_audience_query_over_minimum_scope_survivors',
      }
    );
    assert.equal(res.proof_integrity_status, 'CANDIDATE_OR_CONSTRAINT_MISMATCH');
    markPass('V39_4: DO_NOT_CHANGE without explicit options.requestedPreserveTags/audienceSignals fails closed');
  }

  console.log(`\nALL ${passed}/46 ITEMIZED CHECKS PASSED.`);
}

runItemized46Suite().catch((err) => {
  console.error(err);
  process.exit(1);
});
