// Loads keys from the .env file into process.env (no extra packages needed).
const fs = require("fs");
const path = require("path");

try {
  const text = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#")) {
      process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // no .env file: keys must already be in the environment
}
