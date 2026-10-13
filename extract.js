// Uses the TinyFish web agent to read a scheme page and return structured rules.
const tf = require("./tinyfish");

const GOAL = `Read this Indian government scheme page. If details are on other tabs or linked pages of the SAME scheme (Eligibility, Documents, How to Apply), open them too.
Use ONLY what the official pages say. If something is not stated, use null (or an empty list). Never guess.

Return ONLY this JSON object with exactly these keys:
{
  "name": string,
  "ministry": string or null,
  "summary": string (1-2 plain sentences),
  "benefits": string or null,
  "deadline": string or null,
  "eligibility": {
    "min_age": number or null,
    "max_age": number or null,
    "max_family_income": number or null (annual rupees as a plain number, e.g. 2.5 lakh = 250000),
    "states": [string] (empty list if open to all states),
    "categories": [string] (from General, OBC, SC, ST, EWS; empty list if open to all),
    "genders": [string] (Male, Female, Other; empty list if open to all),
    "education_levels": [string] (e.g. "Class 12", "Undergraduate"; empty list if not stated),
    "occupations": [string] (who it is for, e.g. Student, Farmer, Unemployed, Entrepreneur, Artisan, Worker, Senior citizen, Homemaker; empty list if open to everyone),
    "min_marks_percent": number or null,
    "other": [string] (any other conditions, short sentences)
  },
  "documents": [string] (documents the applicant must provide),
  "evidence": {
    "income": string or null,
    "age": string or null,
    "documents": string or null,
    "deadline": string or null
  }
}
For every "evidence" value, copy one sentence EXACTLY as written on the page (max 25 words), word for word.`;

function toNumber(v) {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  if (typeof v === "number") return v;
  const s = String(v).toLowerCase().replace(/,/g, "");
  const m = s.match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  let n = parseFloat(m[0]);
  if (s.includes("lakh") || s.includes("lac")) n *= 100000;
  else if (s.includes("crore")) n *= 10000000;
  return n;
}

function toList(v) {
  if (v === null || v === undefined) return [];
  if (typeof v === "string") return v.trim() ? [v] : [];
  return Array.isArray(v) ? v.map(String).filter((x) => x.trim()) : [];
}

// The agent's `result` may be an object or a JSON string.
function parseResult(result) {
  if (typeof result === "string") {
    const text = result.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    if (a === -1 || b === -1) throw new Error("Agent returned no JSON");
    result = JSON.parse(text.slice(a, b + 1));
  }
  if (!result || typeof result !== "object") throw new Error("Agent returned an unexpected result");
  const keys = Object.keys(result);
  if (!result.eligibility && keys.length === 1 && typeof result[keys[0]] === "object") {
    result = result[keys[0]];
  }
  return result;
}

function clean(raw) {
  const e = raw.eligibility || {};
  const evidence = {};
  for (const [k, v] of Object.entries(raw.evidence || {})) {
    if (typeof v === "string" || v === null) evidence[k] = v;
  }
  return {
    name: raw.name || "Unnamed scheme",
    ministry: raw.ministry ?? null,
    summary: raw.summary ?? null,
    benefits: raw.benefits ?? null,
    deadline: raw.deadline ?? null,
    eligibility: {
      min_age: toNumber(e.min_age),
      max_age: toNumber(e.max_age),
      max_family_income: toNumber(e.max_family_income),
      states: toList(e.states),
      categories: toList(e.categories),
      genders: toList(e.genders),
      education_levels: toList(e.education_levels),
      occupations: toList(e.occupations),
      min_marks_percent: toNumber(e.min_marks_percent),
      other: toList(e.other),
    },
    documents: toList(raw.documents),
    evidence,
  };
}

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

// A quote counts as verified only if it appears word for word in the fetched page.
function verifyEvidence(scheme, pageText) {
  const hay = norm(pageText);
  scheme.evidence_verified = {};
  for (const [field, quote] of Object.entries(scheme.evidence)) {
    scheme.evidence_verified[field] = Boolean(quote) && hay.includes(norm(quote));
  }
  return scheme;
}

async function extractScheme(pageText, sourceUrl) {
  const run = await tf.runAgent(sourceUrl, GOAL);
  const status = String(run.status || "").toUpperCase();
  if (status && status !== "COMPLETED") {
    throw new Error(`Agent run ${status}: ${JSON.stringify(run.error || run.result || "")}`);
  }
  const scheme = clean(parseResult(run.result));
  scheme.source_url = sourceUrl;
  return verifyEvidence(scheme, pageText);
}

module.exports = { extractScheme };
