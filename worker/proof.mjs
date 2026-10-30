// worker/proof.mjs
// CultureShift AI — Guardian v3.9 Read-Only Decision Proof Post-Processor
// Pure, non-mutating post-processor for runCultureShift output.
// Strictly requires explicit options.requestedPreserveTags, options.audienceSignals,
// options.qlooEndpoint, and options.comparisonContext (zero fallback to runResult fields).

const FIXED_ALLOWED_QLOO_ENDPOINTS = new Set(['/v2/insights']);
const FIXED_ALLOWED_COMPARISON_CONTEXTS = new Set([
  'single_shared_audience_query_over_minimum_scope_survivors',
]);

/**
 * @typedef {Object} ConstraintMembershipResult
 * @property {boolean} constraints_requested
 * @property {'VERIFIED_PROTECTED' | 'UNPROTECTED_NO_CONSTRAINTS_REQUESTED' | 'FAILED_REQUIRED_CONSTRAINTS' | 'INVALID_CONSTRAINT_EVIDENCE' | 'INVALID_ENTITY_ID'} protection_status
 * @property {boolean} hard_and_passed
 * @property {string[]} satisfied_tags
 * @property {string[]} failed_tags
 */

/**
 * @typedef {Object} RankedSurvivorRecord
 * @property {number} rank_position
 * @property {string} entity_id
 * @property {string} name
 * @property {string | null} type
 * @property {string | null} subtype
 * @property {number | null} popularity
 * @property {number | null} affinity
 * @property {boolean} in_minimum_scope_candidates
 * @property {ConstraintMembershipResult} constraint_membership
 */

/**
 * @typedef {Object} CandidateAuditRecord
 * @property {string} entity_id
 * @property {string} name
 * @property {number | null} scope
 * @property {boolean} constraints_requested
 * @property {string} protection_status
 * @property {boolean} hard_and_passed
 * @property {string[]} satisfied_tags
 * @property {string[]} failed_tags
 * @property {number | null} qloo_affinity
 * @property {number | null} qloo_popularity
 * @property {string} disposition
 */

/**
 * Rejects caller attempts to inject pre-computed pipeline outputs or fake Qloo scores
 * into the /api/evaluate request body.
 *
 * @param {unknown} body
 * @returns {{ ok: boolean; error?: string }}
 */
export function assertNoSpoofedEvaluationFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request payload must be a JSON object.' };
  }
  const obj = /** @type {Record<string, unknown>} */ (body);
  const forbiddenKeys = [
    'decision',
    'decision_proof',
    'constraintEvidence',
    'candidatesConsidered',
    'interventionScope',
    'ranking',
    'qloo_evidence',
    'fetched_server_side',
    'baselineQlooAffinity',
    'affinity_score',
  ];
  for (const key of forbiddenKeys) {
    if (key in obj) {
      return {
        ok: false,
        error: `Rejected caller-supplied authoritative pipeline field: "${key}".`,
      };
    }
  }
  if (Array.isArray(obj.candidates)) {
    for (const c of obj.candidates) {
      if (c && typeof c === 'object') {
        const cand = /** @type {Record<string, unknown>} */ (c);
        if (
          'qloo_evidence' in cand ||
          'fetched_server_side' in cand ||
          'affinity' in cand ||
          'affinity_score' in cand ||
          'popularity' in cand
        ) {
          return {
            ok: false,
            error: 'Rejected caller-supplied Qloo score or evidence inside candidate object.',
          };
        }
      }
    }
  }
  return { ok: true };
}

/**
 * Normalizes an identifier or tag string for exact case-insensitive comparison.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeToken(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Validates a finite number in [0, 1].
 * @param {unknown} val
 * @returns {number | null}
 */
function parseFiniteUnitScore(val) {
  if (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > 1) {
    return null;
  }
  return Number(val.toFixed(6));
}

/**
 * Normalizes and validates mandatory server-derived audience signals explicitly supplied via `options.audienceSignals`.
 *
 * @param {unknown} rawAudienceSignals
 * @returns {{ signals: string[]; valid: boolean; provided: boolean }}
 */
function normalizeAudienceSignals(rawAudienceSignals) {
  if (rawAudienceSignals === undefined || rawAudienceSignals === null) {
    return { signals: [], valid: false, provided: false };
  }
  if (typeof rawAudienceSignals === 'string') {
    const trimmed = rawAudienceSignals.trim();
    if (!trimmed) return { signals: [], valid: false, provided: true };
    return { signals: [trimmed], valid: true, provided: true };
  }
  if (!Array.isArray(rawAudienceSignals) || rawAudienceSignals.length === 0) {
    return { signals: [], valid: false, provided: true };
  }
  /** @type {string[]} */
  const signals = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const item of rawAudienceSignals) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      return { signals: [], valid: false, provided: true };
    }
    const trimmed = item.trim();
    const norm = normalizeToken(trimmed);
    if (seen.has(norm)) {
      return { signals: [], valid: false, provided: true };
    }
    seen.add(norm);
    signals.push(trimmed);
  }
  return { signals, valid: signals.length > 0, provided: true };
}

/**
 * Decodes `constraintEvidence` and strictly cross-verifies it against the mandatory
 * explicitly supplied `options.requestedPreserveTags` array.
 *
 * @param {unknown} rawConstraintEvidence
 * @param {unknown} rawRequestedPreserveTags
 * @returns {{
 *   perTagSets: Array<{ tag: string; normalizedTag: string; allowedIds: Set<string>; allowedCount: number }>;
 *   intersectedIds: Set<string>;
 *   requestedTagsProvided: boolean;
 *   constraintsRequested: boolean;
 *   malformedEvidence: boolean;
 *   duplicateAllowedIdDetected: boolean;
 *   missingRequestedTags: string[];
 *   unexpectedExtraTags: string[];
 * }}
 */
function decodeAndVerifyConstraintEvidence(rawConstraintEvidence, rawRequestedPreserveTags) {
  /** @type {Array<{ tag: string; normalizedTag: string; allowedIds: Set<string>; allowedCount: number }>} */
  const perTagSets = [];
  let malformedEvidence = false;
  let duplicateAllowedIdDetected = false;

  const requestedTagsProvided = Array.isArray(rawRequestedPreserveTags);
  if (!requestedTagsProvided) {
    malformedEvidence = true;
  }

  /** @type {unknown[] | null} */
  let listToParse = null;
  if (Array.isArray(rawConstraintEvidence)) {
    listToParse = rawConstraintEvidence;
  } else if (rawConstraintEvidence && typeof rawConstraintEvidence === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (rawConstraintEvidence);
    if (Array.isArray(obj.byTag)) {
      listToParse = obj.byTag;
    } else if (Array.isArray(obj.perTag)) {
      listToParse = obj.perTag;
    } else if (Array.isArray(obj.tags)) {
      listToParse = obj.tags;
    } else {
      malformedEvidence = true;
    }
  } else {
    malformedEvidence = true;
  }

  /** @type {Set<string>} */
  const seenEvidenceTags = new Set();

  if (listToParse) {
    for (const item of listToParse) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        malformedEvidence = true;
        continue;
      }
      const entry = /** @type {Record<string, unknown>} */ (item);
      const rawTag = entry.constraint ?? entry.tag ?? entry.name;
      const tag = typeof rawTag === 'string' && rawTag.trim().length > 0 ? rawTag.trim() : '';
      const normTag = normalizeToken(tag);

      const rawAllowed = Array.isArray(entry.allowed)
        ? entry.allowed
        : Array.isArray(entry.allowedIds)
        ? entry.allowedIds
        : Array.isArray(entry.allowed_ids)
        ? entry.allowed_ids
        : Array.isArray(entry.entity_ids)
        ? entry.entity_ids
        : null;

      if (!tag || !normTag || !rawAllowed) {
        malformedEvidence = true;
        continue;
      }

      if (seenEvidenceTags.has(normTag)) {
        malformedEvidence = true;
        continue;
      }
      seenEvidenceTags.add(normTag);

      /** @type {Set<string>} */
      const idSet = new Set();
      for (const rawId of rawAllowed) {
        if (typeof rawId !== 'string' || rawId.trim().length === 0) {
          malformedEvidence = true;
          continue;
        }
        const normId = normalizeToken(rawId);
        if (idSet.has(normId)) {
          duplicateAllowedIdDetected = true;
          malformedEvidence = true;
          continue;
        }
        idSet.add(normId);
      }

      perTagSets.push({
        tag,
        normalizedTag: normTag,
        allowedIds: idSet,
        allowedCount: idSet.size,
      });
    }
  }

  /** @type {string[]} */
  const missingRequestedTags = [];
  /** @type {string[]} */
  const unexpectedExtraTags = [];
  let explicitRequestedCount = 0;

  if (Array.isArray(rawRequestedPreserveTags)) {
    /** @type {Set<string>} */
    const requestedNormSet = new Set();
    /** @type {Map<string, string>} */
    const requestedOriginalMap = new Map();

    for (const reqTag of rawRequestedPreserveTags) {
      if (typeof reqTag !== 'string' || reqTag.trim().length === 0) {
        malformedEvidence = true;
        continue;
      }
      const norm = normalizeToken(reqTag);
      if (requestedNormSet.has(norm)) {
        malformedEvidence = true;
        continue;
      }
      requestedNormSet.add(norm);
      requestedOriginalMap.set(norm, reqTag.trim());
    }

    explicitRequestedCount = requestedNormSet.size;

    for (const [norm, orig] of requestedOriginalMap.entries()) {
      if (!seenEvidenceTags.has(norm)) {
        missingRequestedTags.push(orig);
      }
    }

    for (const item of perTagSets) {
      if (!requestedNormSet.has(item.normalizedTag)) {
        unexpectedExtraTags.push(item.tag);
      }
    }

    if (missingRequestedTags.length > 0 || unexpectedExtraTags.length > 0) {
      malformedEvidence = true;
    }
  }

  const constraintsRequested = requestedTagsProvided
    ? explicitRequestedCount > 0
    : perTagSets.length > 0;

  /** @type {Set<string>} */
  const intersectedIds = new Set();
  if (perTagSets.length > 0 && !malformedEvidence) {
    const firstSet = perTagSets[0].allowedIds;
    for (const candidateId of firstSet) {
      const inAll = perTagSets.every((t) => t.allowedIds.has(candidateId));
      if (inAll) {
        intersectedIds.add(candidateId);
      }
    }
  }

  return {
    perTagSets,
    intersectedIds,
    requestedTagsProvided,
    constraintsRequested,
    malformedEvidence,
    duplicateAllowedIdDetected,
    missingRequestedTags,
    unexpectedExtraTags,
  };
}

/**
 * Pure read-only post-processor that builds an auditable `decision_proof` receipt
 * strictly from the actual return value of `runCultureShift` and explicitly supplied `options`:
 *   - `options.requestedPreserveTags` (mandatory; never falls back to `runResult`)
 *   - `options.audienceSignals` (mandatory; never falls back to `runResult`)
 *   - `options.qlooEndpoint` (mandatory; must equal `'/v2/insights'`)
 *   - `options.comparisonContext` (mandatory; must equal `'single_shared_audience_query_over_minimum_scope_survivors'`)
 *
 * @param {Record<string, unknown>} runResult
 * @param {{
 *   requestedPreserveTags?: unknown;
 *   audienceSignals?: unknown;
 *   qlooEndpoint?: string;
 *   comparisonContext?: string;
 *   knownCandidatePool?: unknown[];
 * }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function buildDecisionProofFromRunResult(runResult, options = {}) {
  if (!runResult || typeof runResult !== 'object' || Array.isArray(runResult)) {
    throw new Error('buildDecisionProofFromRunResult requires a valid runCultureShift result object.');
  }

  const hasValidOptionsObject = Boolean(
    options && typeof options === 'object' && !Array.isArray(options)
  );

  const rawDecision = runResult.decision;
  const decisionIsValid =
    rawDecision === 'BRIDGE_FOUND' || rawDecision === 'DO_NOT_CHANGE';
  const decision = decisionIsValid
    ? /** @type {'BRIDGE_FOUND' | 'DO_NOT_CHANGE'} */ (rawDecision)
    : String(rawDecision ?? 'INVALID_DECISION');

  const reason = typeof runResult.reason === 'string' ? runResult.reason : null;

  const rawScope = runResult.interventionScope;
  const scopeIsValidInteger =
    typeof rawScope === 'number' &&
    Number.isInteger(rawScope) &&
    rawScope >= 0 &&
    rawScope <= 3;

  const invalidBridgeScopeDetected = decision === 'BRIDGE_FOUND' && !scopeIsValidInteger;
  const interventionScope = scopeIsValidInteger ? /** @type {0 | 1 | 2 | 3} */ (rawScope) : null;

  // V3.9 Requirement 1 Fix: NEVER fall back to runResult.requestedPreserveTags, runResult.preserveTags,
  // runResult.audienceSignals, or runResult.audienceSignal. Only explicit `options.requestedPreserveTags`
  // and `options.audienceSignals` are accepted.
  const effectiveRequestedTags =
    hasValidOptionsObject &&
    Object.prototype.hasOwnProperty.call(options, 'requestedPreserveTags')
      ? options.requestedPreserveTags
      : undefined;

  const rawAudInput =
    hasValidOptionsObject &&
    Object.prototype.hasOwnProperty.call(options, 'audienceSignals')
      ? options.audienceSignals
      : undefined;

  const audienceContext = normalizeAudienceSignals(rawAudInput);

  const endpointExplicitlyProvided = Boolean(
    hasValidOptionsObject && typeof options.qlooEndpoint === 'string'
  );
  const endpointContextValid =
    endpointExplicitlyProvided &&
    FIXED_ALLOWED_QLOO_ENDPOINTS.has(/** @type {string} */ (options.qlooEndpoint));
  const qlooEndpoint = endpointContextValid
    ? /** @type {string} */ (options.qlooEndpoint)
    : null;

  const comparisonContextExplicitlyProvided = Boolean(
    hasValidOptionsObject && typeof options.comparisonContext === 'string'
  );
  const comparisonContextValid =
    comparisonContextExplicitlyProvided &&
    FIXED_ALLOWED_COMPARISON_CONTEXTS.has(/** @type {string} */ (options.comparisonContext));
  const comparisonContext = comparisonContextValid
    ? /** @type {string} */ (options.comparisonContext)
    : null;

  const {
    perTagSets,
    intersectedIds,
    requestedTagsProvided,
    constraintsRequested,
    malformedEvidence,
    duplicateAllowedIdDetected,
    missingRequestedTags,
    unexpectedExtraTags,
  } = decodeAndVerifyConstraintEvidence(runResult.constraintEvidence, effectiveRequestedTags);

  /**
   * Evaluates exact Hard-AND per-tag allowed-ID membership for a given entity ID.
   *
   * @param {string} entityId
   * @returns {ConstraintMembershipResult}
   */
  function evaluateConstraintMembership(entityId) {
    const normId = normalizeToken(entityId);
    /** @type {string[]} */
    const satisfiedTags = [];
    /** @type {string[]} */
    const failedTags = [];

    if (!normId || malformedEvidence) {
      return {
        constraints_requested: constraintsRequested,
        protection_status: malformedEvidence
          ? 'INVALID_CONSTRAINT_EVIDENCE'
          : 'INVALID_ENTITY_ID',
        hard_and_passed: false,
        satisfied_tags: satisfiedTags,
        failed_tags: [
          ...perTagSets.map((t) => t.tag),
          ...missingRequestedTags,
        ],
      };
    }

    if (!constraintsRequested) {
      return {
        constraints_requested: false,
        protection_status: 'UNPROTECTED_NO_CONSTRAINTS_REQUESTED',
        hard_and_passed: false,
        satisfied_tags: [],
        failed_tags: [],
      };
    }

    for (const item of perTagSets) {
      if (item.allowedIds.has(normId)) {
        satisfiedTags.push(item.tag);
      } else {
        failedTags.push(item.tag);
      }
    }

    const hardAndPassed = failedTags.length === 0 && intersectedIds.has(normId);

    return {
      constraints_requested: true,
      protection_status: hardAndPassed ? 'VERIFIED_PROTECTED' : 'FAILED_REQUIRED_CONSTRAINTS',
      hard_and_passed: hardAndPassed,
      satisfied_tags: satisfiedTags,
      failed_tags: failedTags,
    };
  }

  const rawCandidatesConsidered = Array.isArray(runResult.candidatesConsidered)
    ? runResult.candidatesConsidered
    : [];

  /** @type {Array<{ entity_id: string; name: string | null; scope: number | null }>} */
  const normalizedCandidatesConsidered = [];
  /** @type {Set<string>} */
  const minimumScopeCandidateIdSet = new Set();
  let malformedCandidatesConsidered = false;
  let duplicateCandidateConsideredDetected = false;

  if (
    decision === 'BRIDGE_FOUND' &&
    (!Array.isArray(runResult.candidatesConsidered) || rawCandidatesConsidered.length === 0)
  ) {
    malformedCandidatesConsidered = true;
  }

  for (const item of rawCandidatesConsidered) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (!trimmed) {
        malformedCandidatesConsidered = true;
        continue;
      }
      const normId = normalizeToken(trimmed);
      if (minimumScopeCandidateIdSet.has(normId)) {
        duplicateCandidateConsideredDetected = true;
        malformedCandidatesConsidered = true;
        continue;
      }
      minimumScopeCandidateIdSet.add(normId);
      normalizedCandidatesConsidered.push({
        entity_id: trimmed,
        name: null,
        scope: interventionScope,
      });
    } else if (item && typeof item === 'object' && !Array.isArray(item)) {
      const obj = /** @type {Record<string, unknown>} */ (item);
      const rawId =
        typeof obj.entity_id === 'string'
          ? obj.entity_id
          : typeof obj.id === 'string'
          ? obj.id
          : '';
      const trimmed = rawId.trim();
      const itemScope =
        typeof obj.scope === 'number' && Number.isInteger(obj.scope)
          ? obj.scope
          : typeof obj.interventionScope === 'number' && Number.isInteger(obj.interventionScope)
          ? obj.interventionScope
          : interventionScope;
      if (!trimmed) {
        malformedCandidatesConsidered = true;
        continue;
      }
      const normId = normalizeToken(trimmed);
      if (minimumScopeCandidateIdSet.has(normId)) {
        duplicateCandidateConsideredDetected = true;
        malformedCandidatesConsidered = true;
        continue;
      }
      normalizedCandidatesConsidered.push({
        entity_id: trimmed,
        name: typeof obj.name === 'string' ? obj.name : null,
        scope: itemScope,
      });
      if (interventionScope === null || itemScope === interventionScope) {
        minimumScopeCandidateIdSet.add(normId);
      }
    } else {
      malformedCandidatesConsidered = true;
    }
  }

  const rankingObj =
    runResult.ranking && typeof runResult.ranking === 'object' && !Array.isArray(runResult.ranking)
      ? /** @type {Record<string, unknown>} */ (runResult.ranking)
      : null;

  let rankingStatusValid = true;
  if (rankingObj) {
    if (rankingObj.error !== undefined && rankingObj.error !== null && rankingObj.error !== false) {
      rankingStatusValid = false;
    }
    if (rankingObj.ok !== undefined && rankingObj.ok !== true) {
      rankingStatusValid = false;
    }
    if (typeof rankingObj.status === 'string') {
      const normStatus = normalizeToken(rankingObj.status);
      if (normStatus !== 'ok' && normStatus !== 'success') {
        rankingStatusValid = false;
      }
    } else {
      if (decision === 'BRIDGE_FOUND' || rankingObj.status !== undefined) {
        rankingStatusValid = false;
      }
    }
  } else if (decision === 'BRIDGE_FOUND') {
    rankingStatusValid = false;
  }

  const rawRankingResults =
    rankingObj && Array.isArray(rankingObj.results)
      ? /** @type {Array<Record<string, unknown>>} */ (rankingObj.results)
      : [];

  let resultCountConsistent = true;
  if (decision === 'BRIDGE_FOUND') {
    if (
      !rankingObj ||
      typeof rankingObj.result_count !== 'number' ||
      !Number.isInteger(rankingObj.result_count) ||
      rankingObj.result_count !== rawRankingResults.length
    ) {
      resultCountConsistent = false;
    }
  } else if (rankingObj && rankingObj.result_count !== undefined) {
    if (
      typeof rankingObj.result_count !== 'number' ||
      !Number.isInteger(rankingObj.result_count) ||
      rankingObj.result_count !== rawRankingResults.length
    ) {
      resultCountConsistent = false;
    }
  }

  let invalidAffinityDetected = false;
  let invalidPopularityDetected = false;
  let outOfScopeRankedEntityDetected = false;
  let rankedConstraintViolationDetected = false;
  let rankingOrderInconsistent = false;
  let duplicateRankedEntityDetected = false;

  /** @type {Set<string>} */
  const seenRankedEntityIds = new Set();

  /** @type {RankedSurvivorRecord[]} */
  const rankedMinimumScopeSurvivors = [];

  for (let i = 0; i < rawRankingResults.length; i++) {
    const r = rawRankingResults[i];
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      invalidAffinityDetected = true;
      continue;
    }
    const entityId = typeof r.entity_id === 'string' ? r.entity_id.trim() : '';
    if (!entityId) {
      invalidAffinityDetected = true;
      continue;
    }

    const normEntityId = normalizeToken(entityId);
    if (seenRankedEntityIds.has(normEntityId)) {
      duplicateRankedEntityDetected = true;
    }
    seenRankedEntityIds.add(normEntityId);

    const affinity = parseFiniteUnitScore(r.affinity);
    if (affinity === null) {
      invalidAffinityDetected = true;
    }

    let popularity = null;
    if (r.popularity !== undefined && r.popularity !== null) {
      popularity = parseFiniteUnitScore(r.popularity);
      if (popularity === null) {
        invalidPopularityDetected = true;
      }
    }

    const inMinimumScopeSet =
      minimumScopeCandidateIdSet.size > 0 &&
      minimumScopeCandidateIdSet.has(normEntityId);
    if (!inMinimumScopeSet) {
      outOfScopeRankedEntityDetected = true;
    }

    const membership = evaluateConstraintMembership(entityId);
    if (constraintsRequested && !membership.hard_and_passed) {
      rankedConstraintViolationDetected = true;
    }

    rankedMinimumScopeSurvivors.push({
      rank_position: i + 1,
      entity_id: entityId,
      name: typeof r.name === 'string' ? r.name : entityId,
      type: typeof r.type === 'string' ? r.type : null,
      subtype: typeof r.subtype === 'string' ? r.subtype : null,
      popularity,
      affinity,
      in_minimum_scope_candidates: inMinimumScopeSet,
      constraint_membership: membership,
    });
  }

  for (let i = 0; i + 1 < rankedMinimumScopeSurvivors.length; i++) {
    const curr = rankedMinimumScopeSurvivors[i].affinity;
    const next = rankedMinimumScopeSurvivors[i + 1].affinity;
    if (curr !== null && next !== null && next > curr) {
      rankingOrderInconsistent = true;
    }
  }

  let refusalIntersectionInconsistent = false;
  if (decision === 'DO_NOT_CHANGE' && constraintsRequested && !malformedEvidence && intersectedIds.size > 0) {
    if (Array.isArray(options?.knownCandidatePool) && options.knownCandidatePool.length > 0) {
      const poolIds = new Set(
        options.knownCandidatePool
          .map((c) => {
            if (typeof c === 'string') return normalizeToken(c);
            if (c && typeof c === 'object') {
              const obj = /** @type {Record<string, unknown>} */ (c);
              return normalizeToken(obj.entity_id ?? obj.id);
            }
            return '';
          })
          .filter(Boolean)
      );
      const hasFeasibleInPool = Array.from(intersectedIds).some((id) => poolIds.has(id));
      if (hasFeasibleInPool) {
        refusalIntersectionInconsistent = true;
      }
    } else {
      refusalIntersectionInconsistent = true;
    }
  }

  const contextFullyBoundAndValid =
    decisionIsValid &&
    requestedTagsProvided &&
    audienceContext.provided &&
    audienceContext.valid &&
    endpointExplicitlyProvided &&
    endpointContextValid &&
    comparisonContextExplicitlyProvided &&
    comparisonContextValid;

  const allRankedSurvivorsConsistent =
    decision === 'BRIDGE_FOUND' &&
    contextFullyBoundAndValid &&
    !invalidBridgeScopeDetected &&
    !malformedEvidence &&
    !malformedCandidatesConsidered &&
    rankingStatusValid &&
    resultCountConsistent &&
    !duplicateRankedEntityDetected &&
    rawRankingResults.length > 0 &&
    rankedMinimumScopeSurvivors.length === rawRankingResults.length &&
    !invalidAffinityDetected &&
    !invalidPopularityDetected &&
    !outOfScopeRankedEntityDetected &&
    !rankedConstraintViolationDetected &&
    !rankingOrderInconsistent;

  const rankingExecutedValidly = allRankedSurvivorsConsistent;

  /** @type {Map<string, RankedSurvivorRecord>} */
  const rankedByIdMap = new Map(
    rankedMinimumScopeSurvivors.map((item) => [normalizeToken(item.entity_id), item])
  );

  const topCandidate =
    decision === 'BRIDGE_FOUND' && rankedMinimumScopeSurvivors.length > 0
      ? rankedMinimumScopeSurvivors[0]
      : null;

  const topWinnerIsConsistent =
    topCandidate !== null &&
    allRankedSurvivorsConsistent &&
    (!constraintsRequested || topCandidate.constraint_membership.hard_and_passed);

  const authoritativeWinner = topWinnerIsConsistent ? topCandidate : null;

  /** @type {CandidateAuditRecord[]} */
  const candidatesAuditLog = normalizedCandidatesConsidered.map((cand) => {
    const normId = normalizeToken(cand.entity_id);
    const membership = evaluateConstraintMembership(cand.entity_id);
    const rankedRecord = rankedByIdMap.get(normId) || null;

    let disposition = 'EVALUATED_IN_MINIMUM_SCOPE';
    if (malformedEvidence) {
      disposition = 'INVALID_CONSTRAINT_EVIDENCE';
    } else if (constraintsRequested && !membership.hard_and_passed) {
      disposition = 'EXCLUDED_BY_HARD_AND_CONSTRAINTS';
    } else if (
      interventionScope !== null &&
      cand.scope !== null &&
      cand.scope > interventionScope
    ) {
      disposition = 'EXCLUDED_BY_MINIMUM_SCOPE_FILTER';
    } else if (
      authoritativeWinner !== null &&
      normalizeToken(authoritativeWinner.entity_id) === normId
    ) {
      disposition = 'SELECTED_TOP_RANKED_IN_MINIMUM_SCOPE';
    } else if (rankedRecord && rankedRecord.affinity !== null) {
      disposition = 'SURVIVED_MINIMUM_SCOPE_LOWER_QLOO_RANK';
    }

    return {
      entity_id: cand.entity_id,
      name: cand.name ?? rankedRecord?.name ?? cand.entity_id,
      scope: cand.scope,
      constraints_requested: constraintsRequested,
      protection_status: membership.protection_status,
      hard_and_passed: membership.hard_and_passed,
      satisfied_tags: membership.satisfied_tags,
      failed_tags: membership.failed_tags,
      qloo_affinity: rankedRecord ? rankedRecord.affinity : null,
      qloo_popularity: rankedRecord ? rankedRecord.popularity : null,
      disposition,
    };
  });

  /** @type {string[]} */
  const limitations = [
    'Baseline affinity is unmeasured (null): runCultureShift does not execute a separate baseline affinity query.',
    'Unconstrained counterfactual is unavailable (null): runCultureShift applies applyPreserveConstraints and selectMinimumChange before calling qlooRank, so rejected higher-scope or constraint-violating candidates are not scored by Qloo.',
    'qlooRank returns compact normalized entity records (entity_id, name, type, subtype, popularity, affinity) without raw entity tag arrays; protected-constraint compliance is derived strictly from applyPreserveConstraints [{ constraint, allowed }] evidence.',
    'Endpoint label (/v2/insights) and SHA-256 digest record the configured server pipeline context and canonical receipt integrity only; they do not cryptographically authenticate upstream Qloo origin.',
  ];

  if (!decisionIsValid) {
    limitations.push(
      `INTEGRITY_WARNING: Unsupported pipeline decision "${String(rawDecision)}"; expected "BRIDGE_FOUND" or "DO_NOT_CHANGE".`
    );
  }
  if (!requestedTagsProvided) {
    limitations.push(
      'INTEGRITY_WARNING: Explicit options.requestedPreserveTags array was not provided to the Decision Proof builder.'
    );
  }
  if (!audienceContext.provided || !audienceContext.valid) {
    limitations.push(
      'INTEGRITY_WARNING: Explicit options.audienceSignals parameter is missing, unbound, empty, or contains invalid/duplicate entries.'
    );
  }
  if (!endpointExplicitlyProvided || !endpointContextValid) {
    limitations.push(
      'INTEGRITY_WARNING: Explicit allowlisted options.qlooEndpoint ("/v2/insights") was not provided or is invalid.'
    );
  }
  if (!comparisonContextExplicitlyProvided || !comparisonContextValid) {
    limitations.push(
      'INTEGRITY_WARNING: Explicit allowlisted options.comparisonContext was not provided or is invalid.'
    );
  }
  if (!constraintsRequested && !malformedEvidence && decisionIsValid) {
    limitations.push(
      'UNPROTECTED_EVALUATION: requestedPreserveTags and constraintEvidence are empty ([]); zero protected identity constraints were requested or verified.'
    );
  }
  if (malformedEvidence) {
    limitations.push(
      'INTEGRITY_WARNING: constraintEvidence is malformed, contains non-string or duplicate allowed IDs, or does not match options.requestedPreserveTags 1-to-1.'
    );
  }
  if (duplicateAllowedIdDetected) {
    limitations.push(
      'INTEGRITY_WARNING: Duplicate entity IDs detected inside a constraint allowed list.'
    );
  }
  if (duplicateCandidateConsideredDetected) {
    limitations.push(
      'INTEGRITY_WARNING: Duplicate entity IDs detected inside candidatesConsidered.'
    );
  }
  if (!rankingStatusValid) {
    limitations.push(
      'INTEGRITY_WARNING: ranking.status is missing or indicates a non-success status, or ranking.ok is not boolean true.'
    );
  }
  if (!resultCountConsistent) {
    limitations.push(
      'INTEGRITY_WARNING: ranking.result_count is missing or does not match ranking.results.length.'
    );
  }
  if (duplicateRankedEntityDetected) {
    limitations.push(
      'INTEGRITY_WARNING: Duplicate entity_id entries detected in ranking.results.'
    );
  }
  if (invalidPopularityDetected) {
    limitations.push(
      'INTEGRITY_WARNING: One or more ranked entities had non-finite or out-of-range [0, 1] popularity metadata.'
    );
  }
  if (refusalIntersectionInconsistent) {
    limitations.push(
      'INTEGRITY_WARNING: DO_NOT_CHANGE returned despite non-empty allowed-ID intersection without proof of candidate pool disjointness.'
    );
  }
  if (missingRequestedTags.length > 0) {
    limitations.push(
      `INTEGRITY_WARNING: Missing constraintEvidence for requestedPreserveTags: [${missingRequestedTags.join(', ')}].`
    );
  }
  if (unexpectedExtraTags.length > 0) {
    limitations.push(
      `INTEGRITY_WARNING: Unrequested constraint tags present in constraintEvidence: [${unexpectedExtraTags.join(', ')}].`
    );
  }
  if (invalidBridgeScopeDetected) {
    limitations.push(
      `INTEGRITY_WARNING: Invalid interventionScope (${String(rawScope)}) for BRIDGE_FOUND; expected integer in {0, 1, 2, 3}.`
    );
  }
  if (outOfScopeRankedEntityDetected) {
    limitations.push(
      'INTEGRITY_WARNING: One or more ranked entities did not belong to candidatesConsidered (minimum-scope candidate set).'
    );
  }
  if (rankedConstraintViolationDetected) {
    limitations.push(
      'INTEGRITY_WARNING: One or more ranked survivors in ranking.results failed required Hard-AND constraint membership.'
    );
  }
  if (rankingOrderInconsistent) {
    limitations.push(
      'INTEGRITY_WARNING: ranking.results are not ordered by non-increasing Qloo affinity.'
    );
  }
  if (invalidAffinityDetected) {
    limitations.push(
      'INTEGRITY_WARNING: One or more ranked entities had missing, non-finite, or out-of-range [0, 1] affinity scores.'
    );
  }
  if (decision === 'BRIDGE_FOUND' && !topWinnerIsConsistent) {
    limitations.push(
      'INTEGRITY_REFUSAL: Pipeline output failed strict consistency checks; selected_candidate set to null.'
    );
  }

  const proofIntegrityStatus = !decisionIsValid
    ? 'INVALID_PIPELINE_DECISION'
    : decision === 'DO_NOT_CHANGE'
    ? malformedEvidence || refusalIntersectionInconsistent || !contextFullyBoundAndValid
      ? 'CANDIDATE_OR_CONSTRAINT_MISMATCH'
      : 'CONSISTENT_REFUSAL'
    : topWinnerIsConsistent && rankingExecutedValidly
    ? constraintsRequested
      ? 'VERIFIED_PROTECTED_BRIDGE'
      : 'UNPROTECTED_BRIDGE_NO_CONSTRAINTS_REQUESTED'
    : 'CANDIDATE_OR_CONSTRAINT_MISMATCH';

  const canonicalProof = {
    proof_version: '3.9.0-strict-explicit-options',
    pipeline_decision: decision,
    decision_valid: decisionIsValid,
    proof_integrity_status: proofIntegrityStatus,
    query_and_audience_context: {
      audience_signals: audienceContext.signals,
      audience_context_bound: audienceContext.provided && audienceContext.valid,
      requested_preserve_tags_bound: requestedTagsProvided,
      endpoint_label_explicitly_passed: endpointExplicitlyProvided,
      comparison_context_explicitly_passed: comparisonContextExplicitlyProvided,
      endpoint_context_valid: endpointContextValid && comparisonContextValid,
      configured_qloo_endpoint_label: qlooEndpoint,
      comparison_context: comparisonContext,
      provenance_attestation_level:
        'CONFIGURED_SERVER_PIPELINE_LABEL_NOT_CRYPTOGRAPHIC_UPSTREAM_SIGNATURE',
    },
    constraints_requested: constraintsRequested,
    refusal_reason: decision === 'DO_NOT_CHANGE' ? reason : null,
    selected_intervention_scope: decision === 'BRIDGE_FOUND' ? interventionScope : null,
    selected_candidate: authoritativeWinner
      ? {
          entity_id: authoritativeWinner.entity_id,
          name: authoritativeWinner.name,
          type: authoritativeWinner.type,
          subtype: authoritativeWinner.subtype,
          intervention_scope: interventionScope,
          qloo_affinity: authoritativeWinner.affinity,
          qloo_popularity: authoritativeWinner.popularity,
          in_minimum_scope_candidates: authoritativeWinner.in_minimum_scope_candidates,
          identity_protected: authoritativeWinner.constraint_membership.hard_and_passed,
          protection_status: authoritativeWinner.constraint_membership.protection_status,
          constraint_membership: authoritativeWinner.constraint_membership,
        }
      : null,
    counterfactual_comparison: {
      baseline: {
        qloo_affinity: null,
        is_measured: false,
        note: 'Not measured by current runCultureShift pipeline.',
      },
      unconstrained_popularity_max: null,
      minimum_scope_ranked_alternatives:
        topWinnerIsConsistent && rankedMinimumScopeSurvivors.length > 1
          ? rankedMinimumScopeSurvivors.slice(1)
          : [],
    },
    constraint_evidence_summary: {
      requested_preserve_tags_bound: requestedTagsProvided,
      constraints_requested: constraintsRequested,
      evidence_valid: !malformedEvidence,
      duplicate_allowed_ids_detected: duplicateAllowedIdDetected,
      missing_requested_tags: missingRequestedTags,
      unexpected_extra_tags: unexpectedExtraTags,
      per_tag_allowed_counts: perTagSets.map((t) => ({
        constraint: t.tag,
        tag: t.tag,
        allowed_entity_count: t.allowedCount,
      })),
      intersected_allowed_count:
        constraintsRequested && !malformedEvidence ? intersectedIds.size : 0,
      intersected_entity_ids:
        constraintsRequested && !malformedEvidence ? Array.from(intersectedIds) : [],
      raw_constraint_evidence: Array.isArray(runResult.constraintEvidence)
        ? runResult.constraintEvidence
        : [],
    },
    minimum_scope_ranking: {
      ranking_executed: rankingExecutedValidly,
      ranking_status_valid: rankingStatusValid,
      result_count_consistent: resultCountConsistent,
      unique_entities_valid: !duplicateRankedEntityDetected,
      popularity_metadata_valid: !invalidPopularityDetected,
      ranking_order_consistent: !rankingOrderInconsistent,
      result_count: rankingExecutedValidly ? rankedMinimumScopeSurvivors.length : 0,
      results: rankedMinimumScopeSurvivors,
    },
    candidates_considered_audit: candidatesAuditLog,
    uncertainty_and_limitations: limitations,
  };

  const encoded = new TextEncoder().encode(JSON.stringify(canonicalProof));
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const payloadDigest =
    'sha256:' +
    Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

  return {
    ...canonicalProof,
    receipt_payload_sha256: payloadDigest,
    digest_note:
      'Deterministic SHA-256 integrity fingerprint of canonical decision_proof fields. This digest verifies receipt structure and bound parameters only; it does not cryptographically authenticate upstream Qloo origin.',
  };
}
