// YojanaSathi server. Run:  node server.js   then open http://localhost:3000
require("./config");
const http = require("http");
const fs = require("fs");
const path = require("path");

const tf = require("./tinyfish");
const { extractScheme } = require("./extract");
const { matchAll } = require("./match");
const { discover } = require("./discovery");

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data", "schemes.json");

function loadSchemes() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}
function saveSchemes(list) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}

function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("Invalid JSON")); }
    });
  });
}

function cleanProfile(raw = {}) {
  const num = (key) => {
    const v = raw[key];
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    if (Number.isNaN(n)) throw new Error(`'${key}' must be a number`);
    return n;
  };
  const str = (key) => String(raw[key] || "").trim();
  return {
    age: num("age"),
    annual_income: num("annual_income"),
    marks_percent: num("marks_percent"),
    state: str("state"),
    category: str("category"),
    gender: str("gender"),
    education_level: str("education_level"),
    occupation: str("occupation"),
  };
}

const routes = {
  "GET /api/health": async () => {
    const schemes = loadSchemes();
    return {
      ok: true,
      tinyfish_key_set: Boolean(process.env.TINYFISH_API_KEY),
      schemes_loaded: schemes.length,
      using_demo_data: schemes.some((s) => String(s.name).startsWith("DEMO ONLY")),
    };
  },

  "GET /api/schemes": async () => loadSchemes(),

  "POST /api/match": async (body) => {
    const profile = cleanProfile(body.profile);
    return { profile, results: matchAll(loadSchemes(), profile) };
  },

  // Live pipeline: Search -> Fetch -> Agent reads the page -> saved to the cache.
  "POST /api/refresh": async (body) => {
    const query = String(body.query || "").trim();
    if (!query) throw new Error("'query' is required");
    const hits = await tf.search(query, { officialOnly: true, limit: 2 });
    if (!hits.length) throw new Error("No official (gov.in / nic.in) pages found for that query.");
    const { pages } = await tf.fetchPages(hits.map((h) => h.url));
    const schemes = loadSchemes();
    const known = new Set(schemes.map((s) => s.source_url));
    const added = [], errors = [];
    for (const h of hits) {
      if (known.has(h.url)) continue;
      try {
        const s = await extractScheme(pages[h.url] || "", h.url);
        schemes.push(s);
        added.push(s);
      } catch (e) {
        errors.push({ url: h.url, error: e.message });
      }
    }
    saveSchemes(schemes);
    return { added, errors, total: schemes.length };
  },

  // Showcase the TinyFish web agent on any official page.
  "POST /api/agent-demo": async (body) => {
    if (!body.url || !body.goal) throw new Error("'url' and 'goal' are required");
    if (!tf.isOfficial(body.url)) throw new Error("For safety, only gov.in / nic.in URLs are allowed.");
    return tf.runAgent(body.url, body.goal);
  },
};

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    return send(res, 200, fs.readFileSync(path.join(__dirname, "index.html")), "text/html; charset=utf-8");
  }


  // Live discovery for one person. Streams results as server-sent events.
  if (req.method === "POST" && pathname === "/api/discover") {
    let body, profile;
    try {
      body = await readBody(req);
      profile = cleanProfile(body.profile);
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
    const limit = Math.min(Math.max(parseInt(body.limit, 10) || 10, 3), 25);

    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
    let cancelled = false;
    res.on("close", () => { cancelled = true; }); // browser left: stop starting new agent runs
    const emit = (obj) => { if (!cancelled) res.write(`data: ${JSON.stringify(obj)}\n\n`); };
    try {
      await discover({ profile, limit, schemes: loadSchemes(), saveSchemes, emit, isCancelled: () => cancelled });
    } catch (e) {
      emit({ type: "error", message: e.message });
    }
    return res.end();
  }

  const handler = routes[`${req.method} ${pathname}`];
  if (!handler) return send(res, 404, { error: "Not found" });

  try {
    const body = req.method === "POST" ? await readBody(req) : {};
    send(res, 200, await handler(body));
  } catch (e) {
    send(res, 400, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`YojanaSathi running at http://localhost:${PORT}`));
