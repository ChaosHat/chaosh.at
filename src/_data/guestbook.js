// Guestbook entries, fetched live from the VPS at build time and baked into
// /guestbook/ — the site ships no JS, so the page is the render. The
// committed snapshot (guestbookSnapshot.json, refreshed nightly by publish.py)
// is the fallback when the VPS is unreachable, and the copy that outlives it.
// GUESTBOOK_OFFLINE=1 skips the fetch for local builds.
import { readFileSync } from "node:fs";

const LIVE = "https://sign.chaosh.at/entries.json";
const ZONE = "America/New_York";

export default async function () {
  const snapshot = JSON.parse(
    readFileSync(new URL("./guestbookSnapshot.json", import.meta.url), "utf8"),
  );
  let entries = snapshot;
  let source = "snapshot";
  if (!process.env.GUESTBOOK_OFFLINE) {
    try {
      const r = await fetch(LIVE, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const live = await r.json();
      if (!Array.isArray(live)) throw new Error("not an array");
      entries = live;
      source = "live";
    } catch (e) {
      console.warn(`[guestbook] live fetch failed (${e.message}); using snapshot (${snapshot.length})`);
    }
  }
  // Signed-at is a moment, not a filename date, so unlike posts it is shown
  // in Hat's own zone: an evening signing from the US should read as that
  // evening, not as tomorrow in UTC. Both outputs are precomputed here so
  // the template needs no zone-aware filter.
  const text = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, day: "numeric", month: "long", year: "numeric" });
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
  return {
    source,
    entries: entries.map((e) => {
      const d = new Date(e.date);
      return { ...e, dateText: text.format(d), dateISO: iso.format(d) };
    }),
  };
}
