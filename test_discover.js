// Offline test of live discovery using fake TinyFish responses. Run: node test_discover.js
const assert = require("assert");
const tf = require("./tinyfish");

const agentCalls = [];
tf.search = async (q) => [
  { title: "a", url: "https://www.myscheme.gov.in/schemes/farm-1", snippet: "" },
  { title: "b", url: "https://www.myscheme.gov.in/schemes/farm-2", snippet: "" },
  { title: "c", url: "https://example.gov.in/", snippet: "" },
  { title: "d", url: "https://www.myscheme.gov.in/schemes/farm-1/", snippet: "" }, // duplicate
];
tf.fetchPages = async (urls) => ({ pages: Object.fromEntries(urls.map((u) => [u, "Family income must not exceed Rs 5 lakh."])), errors: [] });
tf.runAgent = async (url) => {
  agentCalls.push(url);
  if (url.endsWith("/")) return { status: "COMPLETED", result: { name: "Home page", eligibility: {} } }; // not a scheme
  return { status: "COMPLETED", result: { name: "Scheme " + url.slice(-6), benefits: "Rs 6000", eligibility: { occupations: ["Farmer"], max_family_income: "Rs 5 lakh" }, documents: ["Aadhaar"], evidence: { income: "Family income must not exceed Rs 5 lakh." } } };
};

const { discover, buildQueries } = require("./discovery");
const profile = { age: 30, annual_income: 200000, state: "Bihar", category: "OBC", gender: "Female", education_level: "", occupation: "Farmer", marks_percent: null };

(async () => {
  const q = buildQueries(profile);
  assert.ok(q.length >= 3 && q.length <= 8 && q.some((x) => /farmer/i.test(x)), q.join(" | "));

  const schemes = [], events = [];
  let saves = 0;
  await discover({ profile, limit: 10, schemes, saveSchemes: () => saves++, emit: (e) => events.push(e), isCancelled: () => false });
  const types = events.map((e) => e.type);
  assert.strictEqual(events.find((e) => e.type === "found").total, 3);          // duplicate removed
  assert.strictEqual(types.filter((t) => t === "scheme").length, 2);
  assert.strictEqual(types.filter((t) => t === "skip").length, 1);              // home page skipped
  assert.strictEqual(types[types.length - 1], "done");
  assert.strictEqual(schemes.length, 2);
  assert.ok(events.filter((e) => e.type === "scheme").every((e) => e.result.status === "eligible"));
  assert.ok(events.find((e) => e.type === "scheme").result.checks.some((c) => c.evidence_verified));

  // Second search: everything already saved, so the agent is not called again.
  const before = agentCalls.length;
  const ev2 = [];
  await discover({ profile, limit: 10, schemes, saveSchemes: () => {}, emit: (e) => ev2.push(e), isCancelled: () => false });
  assert.strictEqual(agentCalls.length, before + 1); // only the (never saved) home page is retried
  assert.strictEqual(ev2.filter((e) => e.type === "scheme").length, 2);

  // Cancelled: no agent runs start.
  const before2 = agentCalls.length;
  await discover({ profile, limit: 10, schemes: [], saveSchemes: () => {}, emit: () => {}, isCancelled: () => true });
  assert.strictEqual(agentCalls.length, before2);
  console.log("All discovery tests passed.");
})().catch((e) => { console.error(e); process.exit(1); });
