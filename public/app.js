
const runButton = document.getElementById("run-button");
const resultPanel = document.getElementById("result");

const candidateNames = {
  "E7EBD7F6-5B44-4AEB-BEA0-92317FD35BC3": "Ravi Shankar",
  "B44BC27C-9617-41F8-9143-C9C7B499543A": "Anoushka Shankar",
  "9986F595-C20E-4EBB-828F-55E7DEEBE448": "A.R. Rahman"
};

const constraintNames = {
  "urn:tag:genre:music:indian_classical": "Indian classical music",
  "urn:tag:instrument:qloo:sitar": "Sitar"
};

const scopeNames = {
  0: "No change",
  1: "Discovery and framing",
  2: "Accompaniment and context",
  3: "Core modification"
};

// Escape values before inserting them into HTML.
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

// The Guardian receipt is server-generated. The interface fails closed when
// its decision, selected winner or protection context contradicts the result.
// A SHA-256 fingerprint is NOT an upstream Qloo authentication signature.
function checkDecisionProof(evaluation, protectedCount) {
  const p = evaluation?.decision_proof;
  if (!p || typeof p !== "object" || Array.isArray(p)) {
    return { ok: false, reason: "The server did not return a Guardian decision receipt." };
  }

  const ctx = p.query_and_audience_context;
  const summary = p.constraint_evidence_summary;
  if (
    p.proof_version !== "3.9.0-strict-explicit-options" ||
    p.pipeline_decision !== evaluation.decision ||
    p.decision_valid !== true ||
    !ctx || ctx.audience_context_bound !== true ||
    ctx.requested_preserve_tags_bound !== true ||
    ctx.endpoint_context_valid !== true ||
    ctx.configured_qloo_endpoint_label !== "/v2/insights" ||
    ctx.comparison_context !== "single_shared_audience_query_over_minimum_scope_survivors" ||
    !summary || summary.evidence_valid !== true ||
    summary.requested_preserve_tags_bound !== true ||
    p.constraints_requested !== (protectedCount > 0) ||
    !/^sha256:[0-9a-f]{64}$/.test(p.receipt_payload_sha256 || "")
  ) {
    return { ok: false, reason: "The Guardian receipt does not match the trusted evaluation context." };
  }

  const expectedStatus = protectedCount > 0
    ? "VERIFIED_PROTECTED_BRIDGE"
    : "UNPROTECTED_BRIDGE_NO_CONSTRAINTS_REQUESTED";

  if (evaluation.decision === "DO_NOT_CHANGE") {
    return p.proof_integrity_status === "CONSISTENT_REFUSAL" && p.selected_candidate === null
      ? { ok: true, proof: p }
      : { ok: false, reason: "The Guardian refusal receipt failed validation." };
  }

  if (evaluation.decision !== "BRIDGE_FOUND" ||
    p.proof_integrity_status !== expectedStatus ||
    !p.selected_candidate ||
    !p.minimum_scope_ranking ||
    p.minimum_scope_ranking.ranking_executed !== true ||
    p.minimum_scope_ranking.ranking_order_consistent !== true ||
    p.minimum_scope_ranking.unique_entities_valid !== true ||
    p.minimum_scope_ranking.result_count_consistent !== true ||
    p.selected_candidate.in_minimum_scope_candidates !== true ||
    p.selected_intervention_scope !== evaluation.interventionScope ||
    (protectedCount > 0 && p.selected_candidate.identity_protected !== true) ||
    !Array.isArray(evaluation.ranking?.results) ||
    evaluation.ranking.results.length === 0 ||
    p.minimum_scope_ranking.result_count !== evaluation.ranking.results.length ||
    p.selected_candidate.entity_id !== evaluation.ranking.results[0].entity_id
  ) {
    return { ok: false, reason: "The Guardian winner or minimum-scope evidence is inconsistent." };
  }
  return { ok: true, proof: p };
}

function renderDecisionProof(proof, protectedCount) {
  const isRefusal = proof.pipeline_decision === "DO_NOT_CHANGE";
  const label = isRefusal
    ? "Consistent refusal"
    : protectedCount > 0 ? "Protected recommendation verified" : "Unprotected evaluation";
  const stateText = isRefusal
    ? "The available candidates did not satisfy all mandatory conditions. No change was recommended."
    : protectedCount > 0
      ? "The recommended bridge passed the requested identity checks and minimum-scope ranking consistency checks."
      : "No identity constraints were selected. This result must not be described as identity-protected.";
  const summary = proof.constraint_evidence_summary || {};
  const tags = Array.isArray(summary.per_tag_allowed_counts)
    ? summary.per_tag_allowed_counts : [];
  const rows = tags.map(t => {
    const rawTag = String(t.tag || t.constraint || "Constraint");
    const text = constraintNames[rawTag] || rawTag;
    const count = Number.isInteger(t.allowed_entity_count) ? t.allowed_entity_count : 0;
    return `<li><strong>${escapeHtml(text)}</strong> — ${count} allowed candidate${count === 1 ? "" : "s"}</li>`;
  }).join("");
  const exceptions = Array.isArray(proof.uncertainty_and_limitations)
    ? proof.uncertainty_and_limitations : [];
  const limits = exceptions.filter(x => typeof x === "string").slice(0, 6)
    .map(x => `<li>${escapeHtml(x)}</li>`).join("");
  return `
    <div class="guardian-proof" data-proof-status="${escapeHtml(proof.proof_integrity_status)}">
      <div class="guardian-topline">
        <span class="guardian-label">GUARDIAN · DECISION AUDIT</span>
        <span class="guardian-status">${escapeHtml(label)}</span>
      </div>
      <p class="guardian-meaning">${escapeHtml(stateText)}</p>
      <div class="guardian-metrics">
        <div><span>Protected conditions</span><strong>${protectedCount}</strong></div>
        <div><span>Intersection</span><strong>${Number.isInteger(summary.intersected_allowed_count) ? summary.intersected_allowed_count : 0} candidates</strong></div>
        <div><span>Intervention scope</span><strong>${isRefusal ? "None" : escapeHtml(proof.selected_intervention_scope)}</strong></div>
      </div>
      ${tags.length ? `<details class="guardian-detail"><summary>Show constraint-by-constraint evidence</summary><ul>${rows}</ul></details>` : ""}
      <details class="guardian-detail"><summary>Audit fingerprint and limitations</summary>
        <p><strong>Receipt SHA-256</strong></p><code class="guardian-digest">${escapeHtml(proof.receipt_payload_sha256)}</code>
        <p class="guardian-disclaimer">The digest checks the structure of this server-generated receipt; it does not authenticate the upstream Qloo API. Affinity is a ranking signal, not proof of improved audience engagement.</p>
        ${limits ? `<ul class="guardian-limitations">${limits}</ul>` : ""}
      </details>
    </div>`;
}

async function postJson(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || `${path} failed`);
  }

  return result;
}

function renderConstraints(evidence) {
  if (!evidence.length) {
    return "<p>No constraint evidence was returned.</p>";
  }

  return evidence.map(item => {
    const label = constraintNames[item.constraint] || item.constraint;
    const allowed = (item.allowed || [])
      .map(id => candidateNames[id] || id);

    return `
      <div class="evidence-item">
        <strong>${escapeHtml(label)}</strong>
        <p>${allowed.length
          ? `Passed: ${escapeHtml(allowed.join(", "))}`
          : "No candidate passed this constraint"}</p>
      </div>
    `;
  }).join("");
}

function renderInterventions(result) {
  const candidates = Array.isArray(result.candidates)
    ? result.candidates
    : [];

  const selected = Array.isArray(result.selected)
    ? result.selected
    : [];

  const decision = escapeHtml(result.decision || "Unknown");

  const selectedHtml = selected.length
    ? selected.map(item => `
        <div class="evidence-item">
          <strong>${escapeHtml(item.name)}</strong>
          <p>Scope ${escapeHtml(item.scope)}:
            ${escapeHtml(item.action)}</p>
          <p>Changes core performance:
            ${item.changesCorePerformance ? "Yes" : "No"}</p>
        </div>
      `).join("")
    : "<p>No intervention was selected.</p>";

  const candidatesHtml = candidates.map(item => `
    <li>
      <strong>Scope ${escapeHtml(item.scope)}:
        ${escapeHtml(item.name)}</strong>
      — ${item.feasible ? "Feasible" : "Not feasible"}
      ${item.changesCorePerformance
        ? "(changes core performance)"
        : "(preserves core performance)"}
    </li>
  `).join("");

  return `
    <h3>Minimum intervention feasibility</h3>
    <p><strong>Decision:</strong> ${decision}</p>
    <p><strong>Selected scope:</strong>
      ${result.interventionScope == null
        ? "None"
        : escapeHtml(result.interventionScope)}
    </p>

    ${selectedHtml}

    <h3>Interventions considered</h3>
    <ul>${candidatesHtml}</ul>

    <p class="method-note">
      This feasibility assessment uses CultureShift's
      rule-based intervention model. It is not a Qloo
      prediction of audience engagement or intervention success.
    </p>
  `;
}

runButton.addEventListener("click", async () => {
  const audience = document.getElementById("audience").value;
  const preserveClassical =
    document.getElementById("protect-classical").checked;
  const preserveSitar =
    document.getElementById("protect-sitar").checked;

  runButton.disabled = true;
  runButton.textContent = "Evaluating with CultureShift...";

  resultPanel.innerHTML = `
    <span class="result-label">AGENT DECISION</span>
    <h2>Evaluating cultural bridges...</h2>
    <p>Checking cultural constraints, Qloo affinity,
      and intervention feasibility.</p>
  `;

  try {
    // Existing Qloo-backed cultural bridge evaluation.
    const evaluation = await postJson("/api/evaluate", {
      audience,
      preserveClassical,
      preserveSitar
    });

    const protectedCount = Number(preserveClassical) + Number(preserveSitar);
    const proofCheck = checkDecisionProof(evaluation, protectedCount);
    if (!proofCheck.ok) {
      resultPanel.innerHTML = `
        <span class="result-label">AGENT SAFETY CHECK</span>
        <h2>Result withheld — evidence could not be verified</h2>
        <p>${escapeHtml(proofCheck.reason)}</p>
        <p class="method-note">No candidate is recommended when its decision receipt is missing or inconsistent. Please try again or contact the project team.</p>
      `;
      return;
    }
    const guardianHtml = renderDecisionProof(proofCheck.proof, protectedCount);

    const evidence = Array.isArray(evaluation.constraintEvidence)
      ? evaluation.constraintEvidence
      : [];

    const constraintHtml = renderConstraints(evidence);

    if (evaluation.decision === "DO_NOT_CHANGE") {
      resultPanel.innerHTML = `
        <span class="result-label">AGENT DECISION</span>
        <h2>Do Not Change</h2>
        <p>No candidate satisfies all protected cultural constraints.
          CultureShift refuses to force an incompatible adaptation.</p>
        <h3>Constraint evidence</h3>
        <div class="evidence-grid">${constraintHtml}</div>
        ${guardianHtml}
        <p class="method-note">
          This refusal comes from the cultural bridge
          evaluation. No intervention is recommended.
        </p>
      `;
      return;
    }

    if (evaluation.decision !== "BRIDGE_FOUND") {
      throw new Error("Unexpected cultural bridge decision.");
    }

    // The current bridge candidates use accompaniment/context.
    // Check that this intervention is permitted independently.
    // Scope 1 is not silently substituted for these candidates.
    const intervention = await postJson("/api/interventions", {
      preserveCorePerformance: true,
      allowedInterventionIds: ["accompaniment-context"]
    });

    const interventionAccepted =
      intervention.decision === "MINIMUM_INTERVENTION_FOUND" &&
      intervention.interventionScope === 2 &&
      Array.isArray(intervention.selected) &&
      intervention.selected.some(item =>
        item.id === "accompaniment-context" &&
        item.feasible === true &&
        item.changesCorePerformance === false
      );

    if (!interventionAccepted) {
      resultPanel.innerHTML = `
        <span class="result-label">AGENT DECISION</span>
        <h2>Do Not Change</h2>
        <p>The cultural bridge candidates passed the identity
          constraints, but the required accompaniment/context
          intervention was not approved by the feasibility model.</p>
        ${renderInterventions(intervention)}
        <h3>Constraint evidence</h3>
        <div class="evidence-grid">${constraintHtml}</div>
        ${guardianHtml}
      `;
      return;
    }

    const ranking = Array.isArray(evaluation.ranking?.results)
      ? evaluation.ranking.results
      : [];

    const feasibleIds = new Set(
      evaluation.candidatesConsidered || []
    );

    const rejectedNames = Object.entries(candidateNames)
      .filter(([id]) => !feasibleIds.has(id))
      .map(([, name]) => name);

    const rankingHtml = ranking.map(item => `
      <li>
        <strong>${escapeHtml(item.name)}</strong>
        <span>Qloo affinity:
          ${Number.isFinite(Number(item.affinity))
            ? Number(item.affinity).toFixed(4)
            : "Unavailable"}
        </span>
      </li>
    `).join("");

    const winner = ranking[0];

    resultPanel.innerHTML = `
      <span class="result-label">AGENT DECISION</span>
      <h2>${winner
        ? escapeHtml(winner.name)
        : "Cultural bridge found"}</h2>

      <p><strong>Decision:</strong>
        Feasible cultural bridge with a separately verified
        accompaniment/context intervention.</p>

      <div class="decision-summary">
        <div>
          <span>Intervention</span>
          <strong>Scope 2 — Accompaniment and context</strong>
        </div>
        <div>
          <span>Constraints checked</span>
          <strong>${evidence.length}</strong>
        </div>
        <div>
          <span>Bridge candidates</span>
          <strong>${feasibleIds.size}</strong>
        </div>
      </div>

      <h3>Protected cultural identity</h3>
      <div class="evidence-grid">${constraintHtml}</div>

      ${rejectedNames.length ? `
        <p class="rejected-note">
          <strong>Excluded from final ranking:</strong>
          ${escapeHtml(rejectedNames.join(", "))}
        </p>
      ` : ""}

      ${renderInterventions(intervention)}

      <h3>Qloo ranking of feasible cultural bridges</h3>
      <ol class="ranking-list">${rankingHtml}</ol>

      ${guardianHtml}

      <p class="method-note">
        Qloo affinity ranks the surviving cultural bridge
        candidates. CultureShift's rule-based model separately
        checks whether the proposed intervention is permissible.
        Affinity is not a measured improvement in engagement,
        and these are distinct forms of evidence.
      </p>
    `;

  } catch (error) {
    resultPanel.innerHTML = `
      <span class="result-label">AGENT DECISION</span>
      <h2>Evaluation error</h2>
      <p>${escapeHtml(error.message)}</p>
    `;
  } finally {
    runButton.disabled = false;
    runButton.textContent = "Find Minimum Cultural Bridge";
  }
});
