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
  const utc = { timeZone: "UTC" };

  eleventyConfig.addFilter("dateSlug", (d) => d.toISOString().slice(0, 10));

  eleventyConfig.addFilter("readableDate", (d) =>
    d.toLocaleDateString("en-GB", {
      ...utc,
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
  );

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

  eleventyConfig.addCollection("dailies", (api) =>
    api
      .getFilteredByTag("dailies")
      .filter((p) => !p.data.hold)
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
    const dailies = api
      .getFilteredByTag("dailies")
      .filter((p) => !p.data.hold)
      .sort((a, b) => a.date - b.date); // oldest-first, per spec

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
      return {
        slug,
        ...meta,
        fragments: collected.get(slug) ?? [],
        essayHtml: essay ? md.render(essay.rawInput) : null,
        essayDate: essay ? essay.date : null,
        hasEssay: Boolean(essay),
      };
    });
  });

  // Turn "## Dragon Quest XI S" in a daily post into a link to its subject page.
  eleventyConfig.addFilter("linkSubjects", (html) =>
    String(html ?? "").replace(
      /<h2([^>]*)>([\s\S]*?)<\/h2>/gi,
      (whole, attrs, inner) => {
        const slug = aliasMap.get(normalise(inner.replace(/<[^>]+>/g, "")));
        return slug
          ? `<h2${attrs}><a href="/s/${slug}/">${inner}</a></h2>`
          : whole;
      },
    ),
  );

  // Unmatched headings are a warning, never a build failure — publishing is
  // automated at 2am and a typo must not take the site down.
  eleventyConfig.on("eleventy.after", () => {
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
