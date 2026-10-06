/**
 * CultureShift AI
 * Minimum Cultural Change Engine
 *
 * Prize-first principle:
 * Reach a target taste audience while preserving
 * explicitly protected cultural constraints.
 */

const SCOPE = Object.freeze({
  NO_CHANGE: 0,
  DISCOVERY_FRAMING: 1,
  ACCOMPANIMENT_CONTEXT: 2,
  CORE_MODIFICATION: 3
});

/**
 * Select the minimum-scope feasible intervention.
 *
 * Important:
 * - Feasibility is established before audience ranking.
 * - Protected constraints are hard constraints.
 * - Lower intervention scope is always preferred.
 * - Qloo ranking is used only among candidates in the
 *   lowest feasible scope.
 */
function selectMinimumChange(candidates) {
  if (!Array.isArray(candidates)) {
    throw new TypeError("candidates must be an array");
  }

  const feasible = candidates.filter(
    candidate => candidate.feasible === true
  );

  if (feasible.length === 0) {
    return {
      decision: "DO_NOT_CHANGE",
      reason: "No candidate satisfies all protected constraints."
    };
  }

  const minimumScope = Math.min(
    ...feasible.map(candidate => candidate.scope)
  );

  const minimumChangeCandidates = feasible.filter(
    candidate => candidate.scope === minimumScope
  );

  return {
    decision: "RANK_WITH_QLOO",
    scope: minimumScope,
    candidates: minimumChangeCandidates
  };
}

module.exports = {
  SCOPE,
  selectMinimumChange
};