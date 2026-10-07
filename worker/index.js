const QLOO_BASE_URL = "https://hackathon.api.qloo.com";

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

function appendQuery(url, key, value) {
  if (value === undefined || value === null || value === "") return;

  if (Array.isArray(value)) {
    if (value.length > 0) {
      url.searchParams.set(key, value.join(","));
    }
    return;
  }

  url.searchParams.set(key, String(value));
}

async function qlooInsights(env, query) {
  if (!env.QLOO_API_KEY) {
    throw new Error("QLOO_API_KEY is not configured.");
  }

  const url = new URL("/v2/insights", QLOO_BASE_URL);

  for (const [key, value] of Object.entries(query)) {
    appendQuery(url, key, value);
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-Api-Key": env.QLOO_API_KEY,
      "Accept": "application/json"
    }
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      body?.message ||
      body?.error?.message ||
      body?.error ||
      `Qloo HTTP ${response.status}`
    );
  }

  return body;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        service: "CultureShift AI"
      });
    }

    return Response.json(
      {
        status: "ok",
        message: "CultureShift AI Worker is running."
      },
      { status: 200 }
    );
  }
};