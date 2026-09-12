// Guestbook entries, fetched live from the VPS at build time and baked into
// /guestbook/ — the site ships no JS, so the page is the render. The
// committed snapshot (guestbookSnapshot.json, refreshed nightly by publish.py)
// is the fallback when the VPS is unreachable, and the copy that outlives it.
// GUESTBOOK_OFFLINE=1 skips the fetch for local builds.
import { readFileSync } from "node:fs";

const LIVE = "https://sign.chaosh.at/entries.json";

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
  return {
    source,
    entries: entries.map((e) => ({ ...e, date: new Date(e.date) })),
  };
}
