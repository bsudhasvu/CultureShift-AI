/**
 * CultureShift AI
 * Cultural Constraint Engine
 *
 * Multiple MUST PRESERVE constraints are evaluated
 * independently and intersected by CultureShift.
 *
 * This avoids treating Qloo's tag-union filtering
 * as if it were hard AND semantics.
 */

const { runQloo } = require("./qloo");

/**
 * Extract ranked entity IDs from a Qloo response.
 */
function extractEntityIds(response) {
  const results = response?.results;

  if (!Array.isArray(results)) {
    return [];
  }

  return results
    .map(result =>
      result?.entity_id ||
      result?.entity?.entity_id ||
      result?.entity?.id ||
      result?.id
    )
    .filter(Boolean);
}

/**
 * Intersect candidate IDs while preserving
 * the ordering of the original candidate list.
 */
function intersectCandidates(original, allowedSets) {
  if (allowedSets.length === 0) {
    return [...original];
  }

  return original.filter(candidate =>
    allowedSets.every(set => set.has(candidate))
  );
}

/**
 * Apply MUST PRESERVE constraints independently.
 *
 * Each protected tag receives its own Qloo rank call.
 * CultureShift then performs the AND intersection itself.
 */
async function applyPreserveConstraints({
  options,
  optionType,
  audienceSignals,
  preserveTags = []
}) {
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error("At least one candidate is required.");
  }

  if (preserveTags.length === 0) {
    return {
      feasible: [...options],
      evidence: []
    };
  }

  const evidence = [];
  const allowedSets = [];

  for (const tag of preserveTags) {
    const response = await runQloo("rank", {
      options,
      option_type: optionType,
      signals: audienceSignals,
      include_tags: [tag]
    });

    const allowed = extractEntityIds(response);

    evidence.push({
      constraint: tag,
      allowed
    });

    allowedSets.push(new Set(allowed));
  }

  return {
    feasible: intersectCandidates(options, allowedSets),
    evidence
  };
}

module.exports = {
  extractEntityIds,
  intersectCandidates,
  applyPreserveConstraints
};