// Offline tests. Run: node test_match.js
const assert = require("assert");
const { matchAll } = require("./match");

const schemes = [
  { name: "A", eligibility: { min_age: 16, max_age: 25, max_family_income: 250000, states: [], categories: [], genders: [], education_levels: ["Undergraduate"], min_marks_percent: 60, other: [] }, documents: ["Aadhaar"] },
  { name: "B", eligibility: { max_family_income: 200000, states: ["Bihar"], categories: ["Scheduled Caste", "ST"], genders: [], education_levels: [], other: [] }, documents: [] },
  { name: "C", eligibility: { categories: ["All"], states: ["All India"], genders: ["Girls"] }, documents: [] },
];
const st = (p) => Object.fromEntries(matchAll(schemes, p).map((r) => [r.scheme.name, r.status]));

const priya = { age: 20, annual_income: 250000, state: "Bihar", category: "SC", gender: "Female", education_level: "Undergraduate", marks_percent: 75 };
let s = st(priya);
assert.deepStrictEqual([s.A, s.B, s.C], ["eligible", "not_eligible", "eligible"], JSON.stringify(s));

s = st({ age: 20, education_level: "Undergraduate", marks_percent: 70 });
assert.strictEqual(s.A, "maybe");               // income missing -> maybe, never a silent pass

assert.strictEqual(st({ ...priya, age: 40 }).A, "not_eligible");
assert.strictEqual(st({ ...priya, annual_income: 150000, state: "Kerala" }).B, "not_eligible");
assert.strictEqual(st({ ...priya, annual_income: 150000, category: "Scheduled Caste" }).B, "eligible");
assert.strictEqual(st({ ...priya, gender: "Male" }).C, "not_eligible");

console.log("All match tests passed.");

// ---- occupation + empty-rules guard ----
const farm = { name: "F", eligibility: { occupations: ["Farmers"], max_family_income: 500000 }, documents: [] };
const empty = { name: "E", eligibility: {}, documents: [] };
const run = (sch, p) => matchAll([sch], p)[0].status;
assert.strictEqual(run(farm, { occupation: "Farmer", annual_income: 100000 }), "eligible");
assert.strictEqual(run(farm, { occupation: "Student", annual_income: 100000 }), "not_eligible");
assert.strictEqual(run(farm, { annual_income: 100000 }), "maybe");
assert.strictEqual(run(empty, { occupation: "Farmer" }), "maybe"); // no rules found must never say "eligible"
console.log("Occupation and empty-rules tests passed.");
