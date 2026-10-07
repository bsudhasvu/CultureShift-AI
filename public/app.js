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
    <p>
      CultureShift is checking each protected constraint before
      asking Qloo to rank the surviving candidates.
    </p>
  `;

  try {
    const response = await fetch("/api/evaluate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        audience,
        preserveClassical,
        preserveSitar
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Evaluation failed.");
    }

    const evidence = result.constraintEvidence || [];

    const constraintHtml = evidence
      .map(item => {
        const label =
          constraintNames[item.constraint] || item.constraint;

        const allowedNames = (item.allowed || [])
          .map(id => candidateNames[id] || id);

        return `
          <div class="evidence-item">
            <strong>${label}</strong>
            <span>
              ${
                allowedNames.length
                  ? `Passed: ${allowedNames.join(", ")}`
                  : "No candidate passed this constraint"
              }
            </span>
          </div>
        `;
      })
      .join("");

    if (result.decision === "DO_NOT_CHANGE") {
      resultPanel.innerHTML = `
        <span class="result-label">AGENT DECISION</span>

        <h2>Do Not Change</h2>

        <p>
          No candidate satisfies every protected cultural constraint.
          CultureShift therefore refuses to force an incompatible
          adaptation.
        </p>

        <h3>Constraint evidence</h3>

        <div class="evidence-grid">
          ${constraintHtml}
        </div>
      `;

      return;
    }

    const ranking = result.ranking?.results || [];
    const feasibleIds = new Set(result.candidatesConsidered || []);

    const rejectedNames = Object.entries(candidateNames)
      .filter(([id]) => !feasibleIds.has(id))
      .map(([, name]) => name);

    const rankingHtml = ranking
      .map(
        item => `
          <li>
            <strong>${item.name}</strong>
            <span>
              Qloo affinity ${Number(item.affinity).toFixed(4)}
            </span>
          </li>
        `
      )
      .join("");

    const winner = ranking[0];

    resultPanel.innerHTML = `
      <span class="result-label">AGENT DECISION</span>

      <h2>
        ${winner ? winner.name : "Bridge found"}
      </h2>

      <p>
        <strong>Decision:</strong>
        Best feasible minimum-change cultural bridge
      </p>

      <div class="decision-summary">
        <div>
          <span>Minimum scope</span>
          <strong>${result.interventionScope}</strong>
        </div>

        <div>
          <span>Constraints enforced</span>
          <strong>${evidence.length}</strong>
        </div>

        <div>
          <span>Feasible candidates</span>
          <strong>${result.candidatesConsidered.length}</strong>
        </div>
      </div>

      <h3>Constraint evidence</h3>

      <div class="evidence-grid">
        ${constraintHtml}
      </div>

      ${
        rejectedNames.length
          ? `
            <p class="rejected-note">
              <strong>Filtered from the final ranking:</strong>
              ${rejectedNames.join(", ")}
            </p>
          `
          : ""
      }

      <h3>Qloo ranking of feasible bridges</h3>

      <ol class="ranking-list">
        ${rankingHtml}
      </ol>

      <p class="method-note">
        CultureShift applies protected constraints first. Only the
        surviving candidates at the minimum intervention scope are
        ranked together by Qloo, so the final decision does not trade
        protected identity for a higher audience score.
      </p>
    `;
  } catch (error) {
    resultPanel.innerHTML = `
      <span class="result-label">AGENT DECISION</span>
      <h2>Evaluation error</h2>
      <p>${error.message}</p>
    `;
  } finally {
    runButton.disabled = false;
    runButton.textContent = "Find Minimum Cultural Bridge";
  }
});