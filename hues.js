// The hue ladder, and the lockfile that makes it stable.
//
// A pure hash collides by design, so the wheel is cut into evenly spaced slots
// and each subject hashes to a preferred one; a subject whose slot is taken is
// displaced to the free slot furthest from every claimed one. Written up in
// the vault at 90_Reference/91_Documentation/"chaosh.at Design System".
//
// Until 2026-09-23 the ladder was recomputed from scratch every build, over
// every slug in alphabetical order. Stable across rebuilds of the same set —
// but NOT under additions: a new slug sorting early could claim a slot a later
// one had been holding, and the displacement cascaded. Simulated against the
// real manifest, 13 of 16 plausible new subjects recoloured existing ones (up
// to 34 at once), and crossing a power-of-two boundary repainted the lot.
//
// So assignments are now remembered in hues.lock.json at the repo root:
//   { "slots": 192, "assigned": { "<slug>": <slot index>, ... } }
// Append-only. publish.py keeps it current (hue-lock.mjs) and commits it, so
// the repo still has one writer. The build reads it and runs the same
// assignment for any slug the lock does not know yet (a local build, or a
// night the updater could not run), so output never depends on whether the
// lock was refreshed — only on what it already holds.
//
//   · a known subject never moves.
//   · an unregistered subject keeps its slot in the lock, so forgetting one
//     recolours nothing, and re-registering it brings its colour back.
//   · when every slot is claimed the wheel doubles and each index doubles
//     with it — i of n and 2i of 2n are the same degree, so no hue changes.
//
// With no lock at all this reproduces the old algorithm exactly (slots sized
// up front, alphabetical), which is how the lock was seeded without a single
// colour changing.
import fs from "node:fs";
import { hashOf } from "./aurora.js";

export const SLOT_BASE = 24;
export const LOCK_FILE = "hues.lock.json";

export const readLock = (file = LOCK_FILE) => {
  if (!fs.existsSync(file)) return null;
  const lock = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Number.isInteger(lock?.slots) || typeof lock?.assigned !== "object") {
    throw new Error(`${file}: expected {slots, assigned}`);
  }
  return lock;
};

// -> { slots, assigned: {slug: index} } covering the lock's slugs plus every
// slug given. Never mutates `lock`.
export const assignSlots = (lock, slugs) => {
  let slots = lock?.slots ?? SLOT_BASE;
  let assigned = new Map(Object.entries(lock?.assigned ?? {}));
  const fresh = [...new Set(slugs)].filter((s) => !assigned.has(s)).sort();

  // Seeding: size the wheel up front, as the pre-lock ladder always did.
  if (!lock) while (fresh.length > slots) slots *= 2;

  const used = new Set(assigned.values());
  for (const slug of fresh) {
    if (used.size >= slots) {
      slots *= 2;
      assigned = new Map([...assigned].map(([s, i]) => [s, i * 2]));
      used.clear();
      for (const i of assigned.values()) used.add(i);
    }

    let slot = hashOf(slug) % slots;
    if (used.has(slot)) {
      let bestGap = -1;
      for (let i = 0; i < slots; i += 1) {
        if (used.has(i)) continue;
        let gap = Infinity;
        for (const taken of used) {
          const raw = Math.abs(i - taken);
          gap = Math.min(gap, Math.min(raw, slots - raw));
        }
        if (gap > bestGap) {
          bestGap = gap;
          slot = i;
        }
      }
    }
    used.add(slot);
    assigned.set(slug, slot);
  }

  const sorted = [...assigned].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { slots, assigned: Object.fromEntries(sorted) };
};

// slug -> degree, for the slugs the site renders.
export const huesFrom = ({ slots, assigned }) =>
  new Map(Object.entries(assigned).map(([s, i]) => [s, Math.round((i * 360) / slots)]));

export const lockText = (lock) => `${JSON.stringify(lock, null, 1)}\n`;
