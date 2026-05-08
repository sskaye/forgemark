#!/usr/bin/env node
// Local-only structural-assertion runner for AI-produced Forgemark
// files. No network calls. Validates AI captures without
// re-implementing the parser-level assertions in shell scripts.
//
// Usage:
//   npm run verify-ai-output -- path/to/file.md [--strict]
//
// Default parse mode is tolerant (matches the app's file-open path);
// --strict disables tolerance so any missing marker pair fails.
//
// The script shells out to tsx so it can import the TypeScript format
// layer directly. tsx is a dev dependency of the project.

import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help")) {
  console.error(
    `Usage: npm run verify-ai-output -- <path-to-md> [--strict]\n\n` +
      `Parses the file and reports comment count, anchor classification\n` +
      `(attached / orphaned / floating), and round-trip byte equivalence.`,
  );
  process.exit(args.includes("--help") ? 0 : 1);
}

const strict = args.includes("--strict") ? "1" : "0";
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("missing file path");
  process.exit(1);
}

const inline = `
import { parseForgemarkFile, serializeForgemarkFile } from "./src/format/index.ts";
import { classifyAnchors } from "./src/format/reattach.ts";
import { readFileSync } from "node:fs";
const file = process.env.FM_FILE;
const strict = process.env.FM_STRICT === "1";
const text = readFileSync(file, "utf8");
let parsed;
try {
  parsed = parseForgemarkFile(text, { tolerant: !strict });
} catch (err) {
  console.error("PARSE FAILED: " + err.message);
  process.exit(2);
}
const status = classifyAnchors(parsed.body, parsed.comments);
const counts = { attached: 0, orphaned: 0, floating: 0 };
for (const st of status.values()) counts[st.kind]++;
const roundTrip = serializeForgemarkFile(parsed) === text;
console.log("File: " + file);
console.log("Mode: " + (strict ? "strict" : "tolerant"));
console.log("Comments: " + parsed.comments.length);
console.log("  attached: " + counts.attached);
console.log("  orphaned: " + counts.orphaned);
console.log("  floating: " + counts.floating);
console.log("Round-trips byte-identical: " + (roundTrip ? "yes" : "no"));
if (counts.orphaned > 0 && strict) {
  console.error("FAIL: orphaned comments under --strict.");
  process.exit(3);
}
console.log("OK");
`;

try {
  execFileSync("npx", ["tsx", "-e", inline], {
    cwd: ROOT,
    env: { ...process.env, FM_FILE: file, FM_STRICT: strict },
    stdio: "inherit",
  });
} catch (err) {
  process.exit(err.status ?? 99);
}
