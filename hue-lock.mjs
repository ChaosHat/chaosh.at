// Refreshes hues.lock.json — see hues.js for why the lock exists. Not part of
// the site build: run by publish.py (vault side) against the freshly compiled
// subjects.yaml, before it decides what the night's commit holds.
//
//   node hue-lock.mjs [--subjects <path>] [--check]
//
// --subjects defaults to the repo's own copy; publish.py passes the vault's,
// which is newer on a night a subject was registered. --check writes nothing.
// Prints one JSON line: {"changed": bool, "added": [slug...], "slots": n}.
import fs from "node:fs";
import { load as parseYaml } from "js-yaml";
import { LOCK_FILE, assignSlots, lockText, readLock } from "./hues.js";

const args = process.argv.slice(2);
const at = args.indexOf("--subjects");
const subjectsFile = at >= 0 ? args[at + 1] : "src/_data/subjects.yaml";
const check = args.includes("--check");

const subjects = parseYaml(fs.readFileSync(subjectsFile, "utf8")) || {};
const lock = readLock();
const next = assignSlots(lock, Object.keys(subjects));
const before = fs.existsSync(LOCK_FILE) ? fs.readFileSync(LOCK_FILE, "utf8") : "";
const changed = lockText(next) !== before;
if (changed && !check) fs.writeFileSync(LOCK_FILE, lockText(next));

const known = new Set(Object.keys(lock?.assigned ?? {}));
const added = Object.keys(next.assigned).filter((s) => !known.has(s));
process.stdout.write(`${JSON.stringify({ changed, added, slots: next.slots })}\n`);
