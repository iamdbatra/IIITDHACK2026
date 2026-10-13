// Finds schemes for ONE person, live:
//   1. build search queries from their profile
//   2. TinyFish Search (free) over official gov.in / nic.in sites
//   3. for pages we haven't seen: Fetch + TinyFish web agent reads the rules (a few in parallel)
//   4. match each scheme against the profile and stream every result as soon as it is ready
// Everything the agent reads is saved to data/schemes.json, so the next search is faster.
const tf = require("./tinyfish");
const { extractScheme } = require("./extract");
const { buildResult } = require("./match");

const CONCURRENCY = Number(process.env.AGENT_CONCURRENCY) || 3;

function buildQueries(p) {
  const cat = p.category && p.category !== "General" ? p.category : "";
  const edu = p.education_level || "";
  const state = p.state || "";
  const occ = p.occupation || "";
  const q = [];
  const add = (s) => q.push(s.replace(/\s+/g, " ").trim());

  if (occ && !/student/i.test(occ)) {
    add(`central government scheme for ${occ} India eligibility benefits`);
    if (state) add(`${state} government scheme for ${occ} eligibility`);
    add(`myscheme.gov.in ${occ} scheme ${cat}`);
  }
  if (!occ || /student/i.test(occ) || edu) {
    add(`${cat} ${edu} scholarship scheme India eligibility documents`);
    add(`central government scholarship for ${edu} students ${cat}`);
    if (state) add(`${state} government scholarship scheme ${edu} ${cat}`);
  }
  if (state) add(`${state} government welfare scheme ${cat} eligibility`);
  if (p.gender === "Female") add(`government scheme for women girls ${occ || edu} India`);
  if (p.annual_income !== null && p.annual_income <= 800000) {
    add(`government scheme economically weaker section income limit ${occ || edu}`);
  }
  if (cat) add(`government scheme for ${cat} ${occ} India`);
  add(`myscheme.gov.in ${state} ${occ || edu} ${cat}`);
  return [...new Set(q)].slice(0, 8);
}

const normUrl = (u) => String(u || "").split("#")[0].replace(/\/+$/, "").toLowerCase();

// Scheme detail pages first, bare home pages last.
function rank(url) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("myscheme.gov.in") && u.pathname.startsWith("/schemes/")) return 0;
    return u.pathname.replace(/\/+$/, "") === "" ? 2 : 1;
  } catch {
    return 2;
  }
}

function hasContent(s) {
  const e = s.eligibility || {};
  const rules = [e.min_age, e.max_age, e.max_family_income, e.min_marks_percent].some((v) => v !== null && v !== undefined)
    || [e.states, e.categories, e.genders, e.education_levels, e.occupations, e.other].some((l) => Array.isArray(l) && l.length);
  return rules || (s.documents || []).length > 0 || Boolean(s.benefits);
}

async function discover({ profile, limit, schemes, saveSchemes, emit, isCancelled }) {
  emit({ type: "status", key: "searching" });

  // ---- 1-2. search ----
  const queries = buildQueries(profile);
  const settled = await Promise.allSettled(queries.map((q) => tf.search(q, { officialOnly: true, limit: 10 })));
  const lists = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  if (!lists.length) {
    const why = settled.find((s) => s.status === "rejected");
    throw new Error(why ? why.reason.message : "Search returned nothing.");
  }

  // Round-robin across queries so one query can't crowd out the others.
  const picked = [], seen = new Set();
  for (let i = 0; picked.length < 60 && lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      if (i < l.length && !seen.has(normUrl(l[i].url))) {
        seen.add(normUrl(l[i].url));
        picked.push(l[i].url);
      }
    }
  }
  const urls = picked.map((u, i) => ({ u, i })).sort((a, b) => rank(a.u) - rank(b.u) || a.i - b.i).map((x) => x.u).slice(0, limit);

  // ---- split into already-known and new ----
  const known = new Map(schemes.map((s) => [normUrl(s.source_url), s]));
  const cachedUrls = urls.filter((u) => known.has(normUrl(u)));
  const todo = urls.filter((u) => !known.has(normUrl(u)));
  emit({ type: "found", total: urls.length, cached: cachedUrls.length });

  for (const u of cachedUrls) emit({ type: "scheme", result: buildResult(known.get(normUrl(u)), profile) });
  if (!todo.length || isCancelled()) return emit({ type: "done" });

  // ---- 3. read new pages (Fetch is only used to verify evidence quotes) ----
  let pages = {};
  try {
    for (let i = 0; i < todo.length; i += 10) {
      Object.assign(pages, (await tf.fetchPages(todo.slice(i, i + 10))).pages);
    }
  } catch {
    // evidence quotes will simply show as unverified
  }

  let next = 0;
  const worker = async () => {
    while (!isCancelled()) {
      const url = todo[next++];
      if (!url) return;
      emit({ type: "reading", url });
      try {
        const s = await extractScheme(pages[url] || "", url);
        if (!hasContent(s)) throw new Error("no scheme details found on this page");
        schemes.push(s);
        saveSchemes(schemes);
        emit({ type: "scheme", result: buildResult(s, profile) });
      } catch (e) {
        emit({ type: "skip", url, error: e.message });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  emit({ type: "done" });
}

module.exports = { discover, buildQueries };
