
/**
 * CultureShift AI — Intervention Model
 *
 * Scope values describe the extent of a proposed change.
 * They are defined by CultureShift, not predicted by Qloo.
 */

const INTERVENTIONS = Object.freeze([
  {
    id: "discovery-framing",
    scope: 1,
    name: "Discovery and framing",
    action: "Change the promotional description and audience-facing introduction.",
    changesCorePerformance: false
  },
  {
    id: "accompaniment-context",
    scope: 2,
    name: "Accompaniment and context",
    action: "Add an explanatory introduction or supporting presentation without altering the performance.",
    changesCorePerformance: false
  },
  {
    id: "core-modification",
    scope: 3,
    name: "Core modification",
    action: "Modify elements of the original cultural performance.",
    changesCorePerformance: true
  }
]);

function evaluateInterventions({
  preserveCorePerformance = true,
  allowedInterventionIds = INTERVENTIONS.map(item => item.id)
} = {}) {
  if (!Array.isArray(allowedInterventionIds)) {
    throw new TypeError("allowedInterventionIds must be an array");
  }

  const allowed = new Set(allowedInterventionIds);

  return INTERVENTIONS.map(intervention => ({
    ...intervention,
    feasible:
      allowed.has(intervention.id) &&
      !(preserveCorePerformance && intervention.changesCorePerformance)
  }));
}

module.exports = {
  INTERVENTIONS,
  evaluateInterventions
};
