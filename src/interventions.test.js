
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  evaluateInterventions
} = require("./interventions");

const {
  selectMinimumChange
} = require("./agent");

test("Select Scope 1 when Scopes 1 and 2 are feasible", () => {
  const candidates = evaluateInterventions();
  const result = selectMinimumChange(candidates);

  assert.equal(result.decision, "RANK_WITH_QLOO");
  assert.equal(result.scope, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].id, "discovery-framing");
});

test("Fall back to Scope 2 when Scope 1 is unavailable", () => {
  const candidates = evaluateInterventions({
    allowedInterventionIds: [
      "accompaniment-context",
      "core-modification"
    ]
  });

  const result = selectMinimumChange(candidates);

  assert.equal(result.decision, "RANK_WITH_QLOO");
  assert.equal(result.scope, 2);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].id, "accompaniment-context");
});

test("Protect core performance from modification", () => {
  const candidates = evaluateInterventions({
    preserveCorePerformance: true
  });

  const core = candidates.find(
    candidate => candidate.id === "core-modification"
  );

  assert.equal(core.feasible, false);
});

test("Allow core modification only when explicitly permitted", () => {
  const candidates = evaluateInterventions({
    preserveCorePerformance: false,
    allowedInterventionIds: ["core-modification"]
  });

  const result = selectMinimumChange(candidates);

  assert.equal(result.decision, "RANK_WITH_QLOO");
  assert.equal(result.scope, 3);
});

test("Return DO_NOT_CHANGE when no intervention is allowed", () => {
  const candidates = evaluateInterventions({
    allowedInterventionIds: []
  });

  const result = selectMinimumChange(candidates);

  assert.equal(result.decision, "DO_NOT_CHANGE");
});

test("Reject invalid intervention input", () => {
  assert.throws(
    () => evaluateInterventions({
      allowedInterventionIds: "invalid"
    }),
    TypeError
  );
});

test("Reject invalid minimum-change candidate input", () => {
  assert.throws(
    () => selectMinimumChange(null),
    TypeError
  );
});
