/**
 * CultureShift AI
 * Central Agent Orchestrator
 *
 * Pipeline:
 * 1. Enforce protected cultural constraints.
 * 2. Stop if no acceptable bridge survives.
 * 3. Prefer the minimum intervention scope.
 * 4. Rank surviving alternatives together with Qloo.
 */

const {
  applyPreserveConstraints
} = require("./constraints");

const {
  rankBridges
} = require("./qloo");

const {
  selectMinimumChange
} = require("./agent");

/**
 * Run one CultureShift decision.
 */
async function runCultureShift({
  candidates,
  optionType,
  audienceSignals,
  preserveTags = []
}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("At least one candidate is required.");
  }

  const candidateIds = candidates.map(candidate => candidate.id);

  // STEP 1:
  // Apply each MUST PRESERVE constraint independently.
  const constraintResult = await applyPreserveConstraints({
    options: candidateIds,
    optionType,
    audienceSignals,
    preserveTags
  });

  const feasibleIds = new Set(constraintResult.feasible);

  const constrainedCandidates = candidates.map(candidate => ({
    ...candidate,
    feasible: feasibleIds.has(candidate.id)
  }));

  // STEP 2:
  // Find the lowest intervention scope that still
  // contains at least one feasible candidate.
  const minimumChange = selectMinimumChange(
    constrainedCandidates
  );

  if (minimumChange.decision === "DO_NOT_CHANGE") {
    return {
      decision: "DO_NOT_CHANGE",
      reason: minimumChange.reason,
      constraintEvidence: constraintResult.evidence
    };
  }

  // STEP 3:
  // Rank only candidates from the minimum feasible scope.
  // All alternatives are submitted in the SAME Qloo call.
  const optionsToRank =
    minimumChange.candidates.map(candidate => candidate.id);

  const ranking = await rankBridges({
    options: optionsToRank,
    optionType,
    audienceSignals
  });

  return {
    decision: "BRIDGE_FOUND",
    interventionScope: minimumChange.scope,
    candidatesConsidered: optionsToRank,
    constraintEvidence: constraintResult.evidence,
    ranking
  };
}

module.exports = {
  runCultureShift
};