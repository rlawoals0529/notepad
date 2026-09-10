#!/usr/bin/env node
/**
 * Refuse a runtime dependency that is not React.
 *
 * "Zero dependencies" is a claim that decays the moment it is only in a README, because
 * adding one is a single command and nobody reads the diff of a lockfile. This makes it a
 * check: the units table, the parser and the timezone resolver are hand written on purpose,
 * and each of those decisions has an argument in the file that implements it. Adding a
 * library is allowed, it just has to be a deliberate edit here.
 */
import { readFileSync } from "node:fs";

const ALLOWED = new Set(["react", "react-dom"]);

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const extra = Object.keys(pkg.dependencies ?? {}).filter((name) => !ALLOWED.has(name));

if (extra.length > 0) {
  console.error(`unexpected runtime dependencies: ${extra.join(", ")}`);
  console.error(`only ${[...ALLOWED].join(" and ")} are allowed. Add it here with a reason, or move it to devDependencies.`);
  process.exit(1);
}

console.log(`runtime dependencies: ${Object.keys(pkg.dependencies ?? {}).join(", ") || "none"}`);
