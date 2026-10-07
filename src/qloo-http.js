const QLOO_BASE_URL =
  process.env.QLOO_BASE_URL || "https://hackathon.api.qloo.com";

const INSIGHTS_TYPES = {
  artist: "urn:entity:artist",
  book: "urn:entity:book",
  brand: "urn:entity:brand",
  movie: "urn:entity:movie",
  person: "urn:entity:person",
  place: "urn:entity:place",
  podcast: "urn:entity:podcast",
  tv_show: "urn:entity:tv_show",
  videogame: "urn:entity:videogame"
};

function requireApiKey() {
  const apiKey = process.env.QLOO_API_KEY;

  if (!apiKey) {
    throw new Error(
      "QLOO_API_KEY is not configured. Keep the key server-side and never expose it in frontend code."
    );
  }

  return apiKey;
}

function resolveInsightsType(value) {
  if (!value || typeof value !== "string") {
    throw new Error("A Qloo Insights entity type is required.");
  }

  const normalized = value.trim().toLowerCase();

  if (normalized.startsWith("urn:entity:")) {
    const supported = Object.values(INSIGHTS_TYPES);

    if (supported.includes(normalized)) {
      return normalized;
    }
  }

  const aliases = {
    artists: "artist",
    books: "book",
    brands: "brand",
    movies: "movie",
    people: "person",
    persons: "person",
    places: "place",
    podcasts: "podcast",
    tv: "tv_show",
    show: "tv_show",
    shows: "tv_show",
    "tv show": "tv_show",
    "tv shows": "tv_show",
    videogames: "videogame",
    game: "videogame",
    games: "videogame",
    "video game": "videogame",
    "video games": "videogame"
  };

  const id = aliases[normalized] || normalized;
  const urn = INSIGHTS_TYPES[id];

  if (!urn) {
    throw new Error(`Unsupported Qloo Insights type "${value}".`);
  }

  return urn;
}

function appendQuery(url, key, value) {
  if (value === undefined || value === null || value === "") {
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

async function qlooInsights(query) {
  const apiKey = requireApiKey();
  const url = new URL("/v2/insights", QLOO_BASE_URL);

  for (const [key, value] of Object.entries(query)) {
    appendQuery(url, key, value);
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-Api-Key": apiKey,
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
    const message =
      body?.message ||
      body?.error?.message ||
      body?.error ||
      `HTTP ${response.status}`;

    throw new Error(`Qloo request failed: ${message}`);
  }

  return body;
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const properties =
    value.properties &&
    typeof value.properties === "object" &&
    !Array.isArray(value.properties)
      ? value.properties
      : null;

  const query =
    value.query &&
    typeof value.query === "object" &&
    !Array.isArray(value.query)
      ? value.query
      : null;

  const result = {
    entity_id: value.entity_id ?? value.id,
    name: value.name,
    type: value.type,
    subtype: value.subtype,
    popularity: value.popularity,
    affinity: value.affinity ?? query?.affinity
  };

  if (query?.explainability !== undefined) {
    result.explainability = query.explainability;
  }

  if (properties) {
    const allowedPropertyKeys = [
      "description",
      "short_description",
      "release_year",
      "release_date",
      "content_rating",
      "duration",
      "image",
      "geocode",
      "address",
      "price_level",
      "business_rating"
    ];

    const compactProperties = {};

    for (const key of allowedPropertyKeys) {
      if (properties[key] !== undefined) {
        compactProperties[key] = properties[key];
      }
    }

    if (Object.keys(compactProperties).length > 0) {
      result.properties = compactProperties;
    }
  }

  return result;
}

async function rankBridges({
  options,
  optionType,
  signals = [],
  includeTags = [],
  excludeTags = [],
  signalLocation
}) {
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error("rankBridges requires at least one candidate option.");
  }

  if (
    (!Array.isArray(signals) || signals.length === 0) &&
    !signalLocation
  ) {
    throw new Error(
      "rankBridges requires at least one audience signal or signalLocation."
    );
  }

  const targetType = resolveInsightsType(optionType);

  const query = {
    "filter.type": targetType,
    "filter.results.entities": options,
    take: options.length
  };

  if (signals.length > 0) {
    query["signal.interests.entities"] = signals;
  }

  if (signalLocation) {
    query["signal.location.query"] = signalLocation;
  }

  if (includeTags.length > 0) {
    query["filter.tags"] = includeTags;
    query["operator.filter.tags"] = "union";
  }

  if (excludeTags.length > 0) {
    query["filter.exclude.tags"] = excludeTags;
    query["operator.filter.exclude.tags"] = "union";
  }

  const body = await qlooInsights(query);

  const results = extractEntities(body)
    .map(compactEntity)
    .filter(Boolean)
    .slice(0, options.length);

  return {
    status: "ok",
    results,
    result_count: results.length,
    provenance: {
      endpoint: "/v2/insights",
      query
    }
  };
}

module.exports = {
  rankBridges,
  qlooInsights,
  resolveInsightsType
};