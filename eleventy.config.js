import fs from "node:fs";
import path from "node:path";
import { load as parseYaml } from "js-yaml";
import MarkdownIt from "markdown-it";

// One markdown-it instance renders everything: whole daily posts, the fragments
// sliced out of them, and standing essays. Same instance => a fragment on a
// subject page is byte-identical to the same text on its daily post.
const md = new MarkdownIt({ html: true, linkify: true });

// Headings are matched loosely so "DQXIS", "dqxi s" and "Dragon Quest XI S"
// all land on the same subject.
const normalise = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addPassthroughCopy({ "src/CNAME": "CNAME" });

  eleventyConfig.addDataExtension("yaml", (contents) => parseYaml(contents));
  eleventyConfig.setLibrary("md", md);

  // Dates are always parsed from the YYYY-MM-DD filename, never from mtime,
  // which resets on CI. Format in UTC so the day never shifts.
  //
  // One shared formatter, memoised by timestamp: this runs once per fragment on
  // every subject page plus every archive row, so it is the hottest filter in
  // the build by a wide margin.
  const dateFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const dateCache = new Map();

  eleventyConfig.addFilter("dateSlug", (d) => d.toISOString().slice(0, 10));

  eleventyConfig.addFilter("readableDate", (d) => {
    const key = d.getTime();
    let out = dateCache.get(key);
    if (out === undefined) {
      out = dateFormat.format(d);
      dateCache.set(key, out);
    }
    return out;
  });

  // Dailies render in full on the home page — an excerpt hides the fact that a
  // post covers several subjects. Long days are cut at an H2 boundary so a
  // subject is never shown half-finished; "read more" appears only if cut.
  const HOME_LIMIT = 1500; // visible characters
  const visibleLength = (s) => s.replace(/<[^>]+>/g, "").trim().length;

  eleventyConfig.addFilter("homeBody", (html) => {
    if (!html) return { html: "", truncated: false };
    if (visibleLength(html) <= HOME_LIMIT) return { html, truncated: false };

    const sections = html.split(/(?=<h2[\s>])/i).filter((s) => s.trim());
    let kept = "";
    for (const section of sections) {
      // Always keep the first section, even if it alone exceeds the limit —
      // better a long home page than a sentence cut in half.
      if (kept && visibleLength(kept + section) > HOME_LIMIT) break;
      kept += section;
    }
    return { html: kept, truncated: kept.length < html.length };
  });

  eleventyConfig.addFilter("limit", (arr, n) => arr.slice(0, n));

  // Now Playing is derived, never curated — it is the same `status: active`
  // that groups the shelves, so the two cannot drift apart.
  eleventyConfig.addFilter("nowPlaying", (subjects) =>
    (subjects ?? []).filter((s) => s.status === "active" && !s.hide_from_now),
  );

  // Shelf order: what he's on now first, then finished, then the two kinds of
  // stopped. Within a group, alphabetical.
  const STATUS_ORDER = ["active", "completed", "shelved", "abandoned"];
  eleventyConfig.addFilter("shelveSort", (subjects) =>
    (subjects ?? []).slice().sort((a, b) => {
      const s = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      return s !== 0 ? s : String(a.title).localeCompare(String(b.title));
    }),
  );

  eleventyConfig.addFilter("inCategory", (subjects, category) =>
    (subjects ?? []).filter((s) => (s.category ?? []).includes(category)),
  );

  // Posts missing a usable date are held out of the site entirely rather than
  // published under an invented one. Reported after the build, never fatal.
  const undated = new Set();
  const publishable = (posts) =>
    posts.filter((p) => {
      if (!p.data.datedProperly) {
        undated.add(p.inputPath);
        return false;
      }
      return !p.data.hold;
    });

  eleventyConfig.addCollection("dailies", (api) =>
    publishable(api.getFilteredByTag("dailies")).sort((a, b) => b.date - a.date),
  );

  // "Best of" is zero-length until Hat marks a post `featured: true`. Supporting
  // the flag now costs nothing; the page and its nav link stay hidden until then.
  eleventyConfig.addCollection("featured", (api) =>
    publishable(api.getFilteredByTag("dailies"))
      .filter((p) => p.data.featured === true)
      .sort((a, b) => b.date - a.date),
  );

  // ---------------------------------------------------------------- fan-out
  //
  // The subject page is a VIEW, not a document. Nothing is ever written back
  // into the vault: every build re-slices the daily posts and reassembles them
  // per subject. Registering a subject months later therefore collects every
  // fragment ever written under that heading, correctly back-dated.

  const subjectsFile = path.join("src", "_data", "subjects.yaml");
  const subjects = fs.existsSync(subjectsFile)
    ? parseYaml(fs.readFileSync(subjectsFile, "utf8")) || {}
    : {};

  // normalised heading -> slug
  const aliasMap = new Map();
  for (const [slug, meta] of Object.entries(subjects)) {
    aliasMap.set(normalise(meta.title ?? slug), slug);
    aliasMap.set(normalise(slug), slug);
    for (const alias of meta.aliases ?? []) aliasMap.set(normalise(alias), slug);
  }

  eleventyConfig.addFilter("resolveSubject", (heading) =>
    aliasMap.get(normalise(heading)) ?? null,
  );

  // Split raw markdown on "## " only. H3+ travels with its parent section, and
  // prose above the first H2 belongs to the day, not to any subject.
  const splitSections = (raw) => {
    const sections = [];
    let current = null;
    for (const line of String(raw).split("\n")) {
      const m = /^##(?!#)\s*(.*)$/.exec(line);
      if (m) {
        current = { heading: m[1].trim(), body: [] };
        sections.push(current);
      } else if (current) {
        current.body.push(line);
      }
    }
    return sections;
  };

  const unmatched = new Map(); // normalised heading -> {label, firstSeen}

  eleventyConfig.addCollection("subjectPages", (api) => {
    const dailies = publishable(api.getFilteredByTag("dailies")).sort(
      (a, b) => a.date - b.date, // oldest-first, per spec
    );

    const essays = new Map();
    for (const e of api.getFilteredByTag("essays")) {
      if (e.data.publish === true) essays.set(e.fileSlug, e);
    }

    const collected = new Map(); // slug -> fragments[]

    for (const post of dailies) {
      // Two headings resolving to the same subject in one post merge into a
      // single dated fragment rather than appearing twice under one date.
      const perPost = new Map();

      for (const { heading, body } of splitSections(post.rawInput)) {
        if (!heading) continue; // empty "## " from the daily-note template
        const slug = aliasMap.get(normalise(heading));
        if (!slug) {
          const key = normalise(heading);
          if (!unmatched.has(key)) {
            unmatched.set(key, { label: heading, firstSeen: post.date });
          }
          continue; // stays in the daily post; never auto-created
        }
        const text = body.join("\n").trim();
        if (!text) continue;
        perPost.set(slug, perPost.has(slug) ? `${perPost.get(slug)}\n\n${text}` : text);
      }

      for (const [slug, text] of perPost) {
        if (!collected.has(slug)) collected.set(slug, []);
        collected.get(slug).push({
          date: post.date,
          sourceUrl: post.url,
          html: md.render(text),
        });
      }
    }

    // A subject exists because it is registered, not because it has fragments.
    return Object.entries(subjects).map(([slug, meta]) => {
      const essay = essays.get(slug);
      const essayHtml = essay ? md.render(essay.rawInput) : null;

      // The blurb is Hat's own opening paragraph, not a frontmatter summary —
      // he writes the lede, nothing paraphrases it for him.
      const firstPara = essayHtml?.match(/<p>([\s\S]*?)<\/p>/i);
      const blurb = firstPara
        ? firstPara[1].replace(/<[^>]+>/g, "").trim()
        : null;

      return {
        slug,
        ...meta,
        fragments: collected.get(slug) ?? [],
        essayHtml,
        essayDate: essay ? essay.date : null,
        hasEssay: Boolean(essay),
        blurb,
      };
    });
  });

  // One shelf per category actually in use. Categories are a soft field, so a
  // shelf appears the moment a subject claims it and disappears when none do —
  // no separate list of shelves to keep in step.
  const SHELF_LABELS = {
    games: "Games",
    boardgames: "Board games",
    books: "Books",
    shows: "Shows",
    life: "Life",
  };

  eleventyConfig.addCollection("shelves", (api) => {
    const counts = new Map();
    for (const meta of Object.values(subjects)) {
      for (const cat of meta.category ?? []) {
        counts.set(cat, (counts.get(cat) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([category, count]) => ({
        category,
        label: SHELF_LABELS[category] ?? category,
        count,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  // A subject heading in a daily post becomes a link to its subject page, and is
  // rewritten to the canonical title from subjects.yaml — so "## dqxis" can be
  // typed on a phone and still reads "Dragon Quest XI S" on the site. An
  // unrecognised heading is left exactly as written.
  eleventyConfig.addFilter("linkSubjects", (html) =>
    String(html ?? "").replace(
      /<h2([^>]*)>([\s\S]*?)<\/h2>/gi,
      (whole, attrs, inner) => {
        const slug = aliasMap.get(normalise(inner.replace(/<[^>]+>/g, "")));
        if (!slug) return whole;
        const title = subjects[slug]?.title ?? inner;
        return `<h2${attrs}><a href="/s/${slug}/">${title}</a></h2>`;
      },
    ),
  );

  // Unmatched headings are a warning, never a build failure — publishing is
  // automated at 2am and a typo must not take the site down.
  eleventyConfig.on("eleventy.after", () => {
    if (undated.size > 0) {
      console.warn(
        `\n[chaosh.at] ${undated.size} post(s) NOT PUBLISHED — no usable date:`,
      );
      for (const file of undated) console.warn(`  · ${file}`);
      console.warn(
        `  Rename to YYYY-MM-DD.md, or add "date: YYYY-MM-DD" to the frontmatter.\n`,
      );
    }

    if (unmatched.size === 0) return;
    console.warn(
      `\n[chaosh.at] ${unmatched.size} unclassified heading(s) — not on any subject page:`,
    );
    for (const { label } of unmatched.values()) {
      console.warn(`  · ${label}`);
    }
    console.warn(`  Add them to subjects.yaml to collect them retroactively.\n`);
  });

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site",
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
