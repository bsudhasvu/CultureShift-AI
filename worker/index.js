
const QLOO_BASE_URL = "https://hackathon.api.qloo.com";

const CANDIDATES = [
  {
    id: "E7EBD7F6-5B44-4AEB-BEA0-92317FD35BC3",
    name: "Ravi Shankar",
    scope: 2
  },
  {
    id: "B44BC27C-9617-41F8-9143-C9C7B499543A",
    name: "Anoushka Shankar",
    scope: 2
  },
  {
    id: "9986F595-C20E-4EBB-828F-55E7DEEBE448",
    name: "A.R. Rahman",
    scope: 2
  }
];

const AUDIENCE_SIGNALS = {
  bts: "F347D506-CB6F-46FA-9A8B-AFBC31C71A1A",
  metallica: "C445C761-CB38-4FEE-B085-D35F444A04DF"
};

const PRESERVE_TAGS = {
  classical: "urn:tag:genre:music:indian_classical",
  sitar: "urn:tag:instrument:qloo:sitar"
};

/*
 * Intervention scope is defined by CultureShift.
 * It is not a score or prediction returned by Qloo.
 */
const INTERVENTION_OPTIONS = [
  {
    id: "discovery-framing",
    scope: 1,
    name: "Discovery and framing",
    action:
      "Change the promotional description and audience-facing introduction.",
    changesCorePerformance: false
  },
  {
    id: "accompaniment-context",
    scope: 2,
    name: "Accompaniment and context",
    action:
      "Add an explanatory introduction or supporting presentation without altering the performance.",
    changesCorePerformance: false
  },
  {
    id: "core-modification",
    scope: 3,
    name: "Core modification",
    action:
      "Modify elements of the original cultural performance.",
    changesCorePerformance: true
  }
];

function appendQuery(url, key, value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > 0) {
      url.searchParams.set(key, value.join(","));
    }
    return;
  }

  url.searchParams.set(key, String(value));
}

function extractEntities(response) {
  const results = response?.results;

  if (Array.isArray(results)) {
    return results;
  }

  if (
    results &&
    typeof results === "object" &&
    Array.isArray(results.entities)
  ) {
    return results.entities;
  }

  return [];
}

function compactEntity(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const query =
    value.query &&
    typeof value.query === "object"
      ? value.query
      : null;

  return {
    entity_id: value.entity_id ?? value.id,
    name: value.name,
    type: value.type,
    subtype: value.subtype,
    popularity: value.popularity,
    affinity: value.affinity ?? query?.affinity
  };
}

async function qlooRank(
  env,
  {
    options,
    audienceSignals,
    includeTags = []
  }
) {
  if (!env.QLOO_API_KEY) {
    throw new Error(
      "QLOO_API_KEY is not configured."
    );
  }

  const query = {
    "filter.type": "urn:entity:artist",
    "filter.results.entities": options,
    take: options.length,
    "signal.interests.entities": audienceSignals
  };

  if (includeTags.length > 0) {
    query["filter.tags"] = includeTags;
    query["operator.filter.tags"] = "union";
  }

  const url = new URL(
    "/v2/insights",
    QLOO_BASE_URL
  );

  for (const [key, value] of Object.entries(query)) {
    appendQuery(url, key, value);
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-Api-Key": env.QLOO_API_KEY,
      Accept: "application/json"
    }
  });

  const text = await response.text();

  let body;

  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Qloo returned non-JSON data with HTTP ${response.status}.`
    );
  }

  if (!response.ok) {
    throw new Error(
      body?.message ||
      body?.error?.message ||
      body?.error ||
      `Qloo HTTP ${response.status}`
    );
  }

  const results = extractEntities(body)
    .map(compactEntity)
    .filter(Boolean)
    .slice(0, options.length);

  return {
    status: "ok",
    results,
    result_count: results.length
  };
}

function extractEntityIds(response) {
  if (!Array.isArray(response?.results)) {
    return [];
  }

  return response.results
    .map(result => result?.entity_id)
    .filter(Boolean);
}

function intersectCandidates(original, allowedSets) {
  if (allowedSets.length === 0) {
    return [...original];
  }

  return original.filter(candidate =>
    allowedSets.every(set => set.has(candidate))
  );
}

async function applyPreserveConstraints(
  env,
  {
    options,
    audienceSignals,
    preserveTags = []
  }
) {
  if (preserveTags.length === 0) {
    return {
      feasible: [...options],
      evidence: []
    };
  }

  const evidence = [];
  const allowedSets = [];

  for (const tag of preserveTags) {
    const response = await qlooRank(env, {
      options,
      audienceSignals,
      includeTags: [tag]
    });

    const allowed = extractEntityIds(response);

    evidence.push({
      constraint: tag,
      allowed
    });

    allowedSets.push(new Set(allowed));
  }

  return {
    feasible: intersectCandidates(
      options,
      allowedSets
    ),
    evidence
  };
}

function selectMinimumChange(candidates) {
  const feasible = candidates.filter(
    candidate => candidate.feasible === true
  );

  if (feasible.length === 0) {
    return {
      decision: "DO_NOT_CHANGE",
      reason:
        "No candidate satisfies all protected constraints."
    };
  }

  const minimumScope = Math.min(
    ...feasible.map(candidate => candidate.scope)
  );

  return {
    decision: "RANK_WITH_QLOO",
    scope: minimumScope,
    candidates: feasible.filter(
      candidate => candidate.scope === minimumScope
    )
  };
}

async function runCultureShift(
  env,
  {
    candidates,
    audienceSignals,
    preserveTags = []
  }
) {
  const candidateIds = candidates.map(
    candidate => candidate.id
  );

  const constraintResult =
    await applyPreserveConstraints(env, {
      options: candidateIds,
      audienceSignals,
      preserveTags
    });

  const feasibleIds = new Set(
    constraintResult.feasible
  );

  const constrainedCandidates = candidates.map(
    candidate => ({
      ...candidate,
      feasible: feasibleIds.has(candidate.id)
    })
  );

  const minimumChange = selectMinimumChange(
    constrainedCandidates
  );

  if (
    minimumChange.decision === "DO_NOT_CHANGE"
  ) {
    return {
      decision: "DO_NOT_CHANGE",
      reason: minimumChange.reason,
      constraintEvidence: constraintResult.evidence
    };
  }

  const optionsToRank =
    minimumChange.candidates.map(
      candidate => candidate.id
    );

  const ranking = await qlooRank(env, {
    options: optionsToRank,
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

/*
 * Independent intervention evaluation.
 *
 * This is rule-based decision logic, not Qloo
 * audience-affinity evidence.
 */
function evaluateInterventionRequest(body) {
  const preserveCorePerformance =
    body.preserveCorePerformance !== false;

  const allowedIds =
    body.allowedInterventionIds === undefined
      ? INTERVENTION_OPTIONS.map(
          item => item.id
        )
      : body.allowedInterventionIds;

  if (
    !Array.isArray(allowedIds) ||
    allowedIds.some(
      id => typeof id !== "string"
    )
  ) {
    throw new TypeError(
      "Invalid allowedInterventionIds."
    );
  }

  const allowed = new Set(allowedIds);

  const candidates =
    INTERVENTION_OPTIONS.map(item => ({
      ...item,
      feasible:
        allowed.has(item.id) &&
        !(
          preserveCorePerformance &&
          item.changesCorePerformance
        )
    }));

  const feasible = candidates.filter(
    item => item.feasible
  );

  if (feasible.length === 0) {
    return {
      decision: "DO_NOT_CHANGE",
      reason:
        "No permitted intervention satisfies the defined preservation rules.",
      candidates,
      evidenceType:
        "CultureShift rule-based feasibility; not Qloo audience-affinity evidence"
    };
  }

  const minimumScope = Math.min(
    ...feasible.map(item => item.scope)
  );

  return {
    decision: "MINIMUM_INTERVENTION_FOUND",
    interventionScope: minimumScope,
    selected: feasible.filter(
      item => item.scope === minimumScope
    ),
    candidates,
    evidenceType:
      "CultureShift rule-based feasibility; not Qloo audience-affinity evidence"
  };
}

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8"
      }
    }
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /*
     * New intervention endpoint.
     * Does not call Qloo.
     */
    if (
      request.method === "POST" &&
      url.pathname === "/api/interventions"
    ) {
      let body;

      try {
        body = await request.json();
      } catch {
        return json(
          { error: "Invalid JSON request." },
          400
        );
      }

      try {
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body)
        ) {
          return json(
            { error: "Expected a JSON object." },
            400
          );
        }

        return json(
          evaluateInterventionRequest(body)
        );
      } catch (error) {
        if (error instanceof TypeError) {
          return json(
            { error: error.message },
            400
          );
        }

        return json(
          {
            error:
              "Intervention evaluation failed."
          },
          500
        );
      }
    }

    /*
     * Existing health endpoint.
     */
    if (
      request.method === "GET" &&
      url.pathname === "/health"
    ) {
      return json({
        status: "ok",
        service: "CultureShift AI"
      });
    }

    /*
     * Existing Qloo-backed cultural bridge endpoint.
     */
    if (
      request.method === "POST" &&
      url.pathname === "/api/evaluate"
    ) {
      try {
        const body = await request.json();

        const audienceSignal =
          AUDIENCE_SIGNALS[body.audience];

        if (!audienceSignal) {
          return json(
            {
              error: "Unsupported audience."
            },
            400
          );
        }

        const requestedPreserveTags = [];

        const preserve =
          Array.isArray(body.preserve)
            ? body.preserve
            : [];

        if (
          body.preserveClassical ||
          preserve.includes("classical")
        ) {
          requestedPreserveTags.push(
            PRESERVE_TAGS.classical
          );
        }

        if (
          body.preserveSitar ||
          preserve.includes("sitar")
        ) {
          requestedPreserveTags.push(
            PRESERVE_TAGS.sitar
          );
        }

        const result = await runCultureShift(
          env,
          {
            candidates: CANDIDATES,
            audienceSignals: [
              audienceSignal
            ],
            preserveTags:
              requestedPreserveTags
          }
        );

        return json(result);
      } catch (error) {
        console.error(
          "CultureShift evaluation failed:",
          error
        );

        return json(
          {
            error:
              "CultureShift evaluation failed."
          },
          500
        );
      }
    }

    return json(
      {
        status: "ok",
        service: "CultureShift AI",
        message:
          "Use POST /api/evaluate for Qloo cultural ranking or POST /api/interventions for rule-based intervention evaluation."
      },
      200
    );
  }
};
