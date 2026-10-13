// Talks to TinyFish: Search, Fetch and the web Agent.
require("./config");

const SEARCH_URL = "https://api.search.tinyfish.ai";
const FETCH_URL = "https://api.fetch.tinyfish.ai";
const AGENT_RUN_URL = "https://agent.tinyfish.ai/v1/automation/run";

function headers() {
  const key = process.env.TINYFISH_API_KEY;
  if (!key) throw new Error("TINYFISH_API_KEY is not set. Put it in your .env file.");
  return { "X-API-Key": key };
}

// Only trust official government sites.
function isOfficial(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith(".gov.in") || host.endsWith(".nic.in") || host === "gov.in" || host === "nic.in";
  } catch {
    return false;
  }
}

async function search(query, { officialOnly = true, limit = 8 } = {}) {
  const res = await fetch(`${SEARCH_URL}?${new URLSearchParams({ query })}`, { headers: headers() });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const data = await res.json();
  return (data.results || [])
    .filter((r) => !officialOnly || isOfficial(r.url))
    .map((r) => ({ title: r.title || "", url: r.url, snippet: r.snippet || "" }))
    .slice(0, limit);
}

// Returns { pages: {url: text}, errors: [...] }
async function fetchPages(urls) {
  urls = urls.slice(0, 10);
  if (!urls.length) return { pages: {}, errors: [] };
  const res = await fetch(FETCH_URL, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ urls, format: "markdown" }),
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  const data = await res.json();
  const pages = {};
  for (const item of data.results || []) {
    if (typeof item.text === "string" && item.text.trim()) {
      pages[item.url || item.final_url] = item.text;
    }
  }
  return { pages, errors: data.errors || [] };
}

// Lets the TinyFish web agent browse a page and do `goal`. Slow (1-2 min) and uses credits.
async function runAgent(url, goal) {
  const res = await fetch(AGENT_RUN_URL, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ url, goal }),
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) throw new Error(`Agent request failed (${res.status})`);
  return res.json();
}

module.exports = { isOfficial, search, fetchPages, runAgent };
