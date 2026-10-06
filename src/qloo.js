/**
 * CultureShift AI
 * Qloo Integration Layer
 *
 * Security:
 * - Never store the Qloo API key in source code.
 * - Qloo authentication remains in the configured environment.
 *
 * Methodology:
 * - Compare competing candidates within the SAME rank call.
 * - Scores from separate rank calls must not be compared.
 */

const { execFile } = require("node:child_process");

function runQloo(workflow, input) {
  return new Promise((resolve, reject) => {
    const args = [
      "exec",
      workflow,
      "--input",
      JSON.stringify(input)
    ];

    execFile(
      "qloo",
      args,
      {
        windowsHide: true,
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              stderr?.trim() ||
              stdout?.trim() ||
              error.message
            )
          );
          return;
        }

        const output = stdout.trim();

        try {
          resolve(JSON.parse(output));
        } catch {
          resolve({
            raw: output
          });
        }
      }
    );
  });
}

/**
 * Rank all feasible bridge candidates together.
 * This preserves valid same-call comparison.
 */
async function rankBridges({
  options,
  optionType,
  audienceSignals
}) {
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error("At least one bridge candidate is required.");
  }

  if (!Array.isArray(audienceSignals) ||
      audienceSignals.length === 0) {
    throw new Error("At least one audience signal is required.");
  }

  return runQloo("rank", {
    options,
    option_type: optionType,
    signals: audienceSignals
  });
}

module.exports = {
  runQloo,
  rankBridges
};