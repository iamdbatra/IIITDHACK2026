// Eligibility matching in plain JavaScript. No AI: every decision is an `if`.
// Each check has ok = true (passes), false (fails) or null (unknown, user should verify).

const rupees = (n) => "₹" + Number(n).toLocaleString("en-IN");

// ---- normalising helpers so "Scheduled Tribe" matches "ST", etc. ----
function canonCategory(s) {
  s = String(s || "").toLowerCase();
  if (s.includes("scheduled caste") || /\bsc\b/.test(s)) return "sc";
  if (s.includes("scheduled tribe") || /\bst\b/.test(s)) return "st";
  if (s.includes("other backward") || /\bobc\b/.test(s)) return "obc";
  if (s.includes("economically weaker") || /\bews\b/.test(s)) return "ews";
  if (s.includes("general") || s.includes("unreserved")) return "general";
  return s.trim();
}
function canonGender(s) {
  s = String(s || "").toLowerCase();
  if (/female|women|woman|girl/.test(s)) return "female";
  if (/\bmale\b|\bmen\b|\bman\b|\bboy/.test(s)) return "male";
  return s.trim();
}
const KNOWN_OCC = new Set(["student", "farmer", "unemployed", "entrepreneur", "artisan", "worker", "senior", "homemaker"]);
function canonOccupation(s) {
  s = String(s || "").toLowerCase();
  if (/unemploy|job ?seek/.test(s)) return "unemployed";
  if (/entrepreneur|self[- ]?employ|business|msme|start ?up/.test(s)) return "entrepreneur";
  if (/student|scholar|learner/.test(s)) return "student";
  if (/farm|agri|kisan|cultivat/.test(s)) return "farmer";
  if (/artisan|craft|weaver/.test(s)) return "artisan";
  if (/worker|labou?r|salaried/.test(s)) return "worker";
  if (/senior|elderly|old age|pensioner/.test(s)) return "senior";
  if (/home ?maker|housewife/.test(s)) return "homemaker";
  return s.trim();
}
const clean = (list) => (Array.isArray(list) ? list : []).map((x) => String(x).trim()).filter(Boolean);
const openToAll = (list) => clean(list).length === 0 || clean(list).some((x) => x.toLowerCase().startsWith("all") || x.toLowerCase() === "any");

function check(field, ok, message, evidence = null, verified = false) {
  return { field, ok, message, evidence, evidence_verified: verified };
}

function checkScheme(scheme, profile) {
  const e = scheme.eligibility || {};
  const ev = scheme.evidence || {};
  const evv = scheme.evidence_verified || {};
  const checks = [];
  const has = (v) => v !== null && v !== undefined && v !== "";

  // Age
  const { min_age: lo, max_age: hi } = e;
  if (has(lo) || has(hi)) {
    const q = ev.age, v = !!evv.age, age = profile.age;
    if (!has(age)) checks.push(check("age", null, "Age is needed for this scheme. Please enter it.", q, v));
    else if (has(lo) && age < lo) checks.push(check("age", false, `Minimum age is ${lo}; you are ${age}.`, q, v));
    else if (has(hi) && age > hi) checks.push(check("age", false, `Maximum age is ${hi}; you are ${age}.`, q, v));
    else checks.push(check("age", true, "Your age meets the requirement.", q, v));
  }

  // Income
  const cap = e.max_family_income;
  if (has(cap)) {
    const q = ev.income, v = !!evv.income, inc = profile.annual_income;
    if (!has(inc)) checks.push(check("income", null, `Family income limit is ${rupees(cap)}. Please enter yours.`, q, v));
    else if (inc > cap) checks.push(check("income", false, `Family income must be at most ${rupees(cap)}; yours is ${rupees(inc)}.`, q, v));
    else checks.push(check("income", true, `Your income is within the ${rupees(cap)} limit.`, q, v));
  }

  // State
  if (!openToAll(e.states)) {
    const state = String(profile.state || "").trim().toLowerCase();
    const allowed = clean(e.states).map((s) => s.toLowerCase());
    const list = clean(e.states).join(", ");
    if (!state) checks.push(check("state", null, "This scheme is limited to some states. Please select your state."));
    else if (allowed.some((a) => a === state || a.includes(state) || state.includes(a))) checks.push(check("state", true, "Your state is covered."));
    else checks.push(check("state", false, `Only for: ${list}.`));
  }

  // Category
  if (!openToAll(e.categories)) {
    const cat = canonCategory(profile.category);
    const allowed = clean(e.categories).map(canonCategory);
    const list = clean(e.categories).join(", ");
    if (!cat) checks.push(check("category", null, "Category matters for this scheme. Please select it."));
    else if (allowed.includes(cat)) checks.push(check("category", true, "Your category is eligible."));
    else checks.push(check("category", false, `Only for categories: ${list}.`));
  }

  // Gender
  if (!openToAll(e.genders)) {
    const g = canonGender(profile.gender);
    const allowed = clean(e.genders).map(canonGender);
    const list = clean(e.genders).join(", ");
    if (!g) checks.push(check("gender", null, "This scheme is gender-specific. Please select gender."));
    else if (allowed.includes(g)) checks.push(check("gender", true, "Gender requirement met."));
    else checks.push(check("gender", false, `Only for: ${list}.`));
  }

  // Education. A mismatch is "check this" (not a hard fail) because wording varies a lot.
  if (clean(e.education_levels).length) {
    const edu = String(profile.education_level || "").trim().toLowerCase();
    const allowed = clean(e.education_levels).map((x) => x.toLowerCase());
    const list = clean(e.education_levels).join(", ");
    if (!edu) checks.push(check("education", null, "Please select your education level."));
    else if (allowed.some((a) => a.includes(edu) || edu.includes(a))) checks.push(check("education", true, "Your education level fits."));
    else checks.push(check("education", null, `Meant for: ${list}. Check that this fits you.`));
  }

  // Marks
  const mm = e.min_marks_percent;
  if (has(mm)) {
    const marks = profile.marks_percent;
    if (!has(marks)) checks.push(check("marks", null, `Needs at least ${mm}% marks. Please enter yours.`));
    else if (marks < mm) checks.push(check("marks", false, `Needs at least ${mm}% marks; you have ${marks}%.`));
    else checks.push(check("marks", true, "Your marks meet the requirement."));
  }

  // Occupation (farmer, student, ...). Known groups that don't overlap = fail; unclear wording = "check this".
  if (clean(e.occupations).length && !openToAll(e.occupations)) {
    const mine = canonOccupation(profile.occupation);
    const allowed = clean(e.occupations).map(canonOccupation);
    const list = clean(e.occupations).join(", ");
    if (!mine) checks.push(check("occupation", null, "Please select your occupation."));
    else if (allowed.includes(mine)) checks.push(check("occupation", true, "Your occupation fits."));
    else if (allowed.every((a) => KNOWN_OCC.has(a))) checks.push(check("occupation", false, `Meant for: ${list}.`));
    else checks.push(check("occupation", null, `Meant for: ${list}. Check that this fits you.`));
  }

  // A scheme with no readable rules must never look "eligible".
  if (checks.length === 0) {
    checks.push(check("rules", null, "No clear eligibility rules were found for this scheme. Please read the official page."));
  }

  let status = "eligible";
  if (checks.some((c) => c.ok === false)) status = "not_eligible";
  else if (checks.some((c) => c.ok === null)) status = "maybe";

  return { status, checks, to_verify: clean(e.other), scheme };
}

function explain(result) {
  const intro = {
    eligible: "You look eligible for this scheme.",
    maybe: "You may be eligible. A few details need checking.",
    not_eligible: "You do not seem eligible for this scheme.",
  }[result.status];
  const problems = result.checks.filter((c) => c.ok !== true).map((c) => c.message).join(" ");
  const outro = "Please confirm on the official website.";
  return [intro, problems, outro].filter(Boolean).join(" ");
}

// One scheme -> everything the page needs to draw its card.
function buildResult(scheme, profile) {
  const r = checkScheme(scheme, profile);
  r.explanation = explain(r);
  r.checklist = (scheme.documents || []).map((d) => ({ item: d, source_url: scheme.source_url }));
  return r;
}

function matchAll(schemes, profile) {
  const order = { eligible: 0, maybe: 1, not_eligible: 2 };
  return schemes.map((s) => buildResult(s, profile)).sort((a, b) => order[a.status] - order[b.status]);
}

module.exports = { checkScheme, buildResult, matchAll };
