const runButton = document.getElementById("run-button");
const resultPanel = document.getElementById("result");

runButton.addEventListener("click", async () => {
  const audience = document.getElementById("audience").value;

  const preserveClassical =
    document.getElementById("protect-classical").checked;

  const preserveSitar =
    document.getElementById("protect-sitar").checked;

  runButton.disabled = true;
  runButton.textContent = "Evaluating with CultureShift...";

  resultPanel.innerHTML = `
    <h2>CultureShift Decision</h2>
    <p>Checking protected constraints and Qloo audience alignment...</p>
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

    if (result.decision === "DO_NOT_CHANGE") {
      resultPanel.innerHTML = `
        <h2>CultureShift Decision</h2>
        <p><strong>Decision:</strong> Do Not Change</p>
        <p>
          No candidate satisfied all protected cultural constraints.
          CultureShift will not force an incompatible adaptation.
        </p>
      `;
      return;
    }

    const ranking = result.ranking?.results || [];

    const rankingHtml = ranking
      .map(
        (item, index) => `
          <li>
            <strong>${item.name}</strong>
            — Qloo affinity ${Number(item.affinity).toFixed(4)}
          </li>
        `
      )
      .join("");

    const winner = ranking[0];

    resultPanel.innerHTML = `
      <h2>CultureShift Decision</h2>

      <p>
        <strong>Decision:</strong> Cultural bridge found
      </p>

      <p>
        <strong>Minimum intervention scope:</strong>
        ${result.interventionScope}
      </p>

      <p>
        <strong>Protected constraints passed:</strong>
        ${result.constraintEvidence.length}
      </p>

      <p>
        <strong>Best feasible bridge:</strong>
        ${winner ? winner.name : "No ranked candidate"}
      </p>

      <h3>Qloo ranking of feasible bridges</h3>

      <ol>
        ${rankingHtml}
      </ol>

      <p>
        CultureShift first enforced the protected cultural constraints,
        then ranked only the surviving minimum-scope candidates together
        for the selected audience.
      </p>
    `;
  } catch (error) {
    resultPanel.innerHTML = `
      <h2>CultureShift Decision</h2>
      <p><strong>Evaluation error:</strong> ${error.message}</p>
    `;
  } finally {
    runButton.disabled = false;
    runButton.textContent = "Find Minimum Cultural Bridge";
  }
});