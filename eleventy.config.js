import fs from "node:fs";
import path from "node:path";
import { load as parseYaml } from "js-yaml";
import MarkdownIt from "markdown-it";
import { subjectSvg, chipSvg, headerSvgs } from "./aurora.js";

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
  eleventyConfig.addPassthroughCopy({ "src/fonts": "fonts" });
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

  // RFC 3339, which Atom requires.
  eleventyConfig.addFilter("atomDate", (d) => d.toISOString());

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

  // Tags are a curated VIEW over several subjects — /t/final-fantasy/ gathers
  // every fragment ever written about any Final Fantasy game onto one page.
  //
  // Membership is authored on the TAG, not restated on each subject, for two
  // reasons. Inventing a tag is then one edit in one place rather than a sweep
  // through every entry it touches; and a hand-kept member list reads as
  // editorial, which is what a tag like `atlus` actually is — "same DNA and
  // lineage", not "everything this studio shipped". A per-subject field would
  // have quietly invited completionism.
  //
  // Deliberately NOT a category: a category is a shelf and mints a nav link, so
  // one per genre would bury the nav. Tags are reached from the pages they
  // describe. And deliberately NOT a subject: Hat writes about Final Fantasy
  // games, never about Final Fantasy in the abstract, so a tag needs no essay,
  // no status and no Now Playing slot.
  // Named tagviews, not tags, and that is not cosmetic: `tags` is reserved in
  // Eleventy's data cascade — a global of that name is read as every template's
  // collection membership and the build dies before rendering anything. The
  // vault-side file Hat edits keeps the honest name; publish.py renames the copy.
  const tagsFile = path.join("src", "_data", "tagviews.yaml");
  const tags = fs.existsSync(tagsFile)
    ? parseYaml(fs.readFileSync(tagsFile, "utf8")) || {}
    : {};

  // Authored one way, needed both ways: tag -> members builds /t/<slug>/, and
  // subject -> tags prints the tag line on a subject page and the daily footer.
  const tagsOfSubject = new Map();
  for (const [tagSlug, meta] of Object.entries(tags)) {
    for (const member of meta?.members ?? []) {
      if (!tagsOfSubject.has(member)) tagsOfSubject.set(member, []);
      const list = tagsOfSubject.get(member);
      if (!list.includes(tagSlug)) list.push(tagSlug);
    }
  }

  const tagLinks = (slugs) =>
    (slugs ?? []).map((t) => ({ slug: t, title: tags[t]?.title ?? t }));

  // ------------------------------------------------------------------- sky
  //
  // Generated cover art: the slug picks the hue and seeds the aurora's path,
  // status picks how much aurora is left in the sky, recency picks how bright
  // it burns. Written up in the vault at 90_Reference/91_Documentation/
  // "chaosh.at Design System" — including why hues sit on a ladder rather
  // than hashing straight to a degree.
  const SLOT_BASE = 24;

  const hashOf = (slug) => {
    let h = 2166136261;
    for (let i = 0; i < slug.length; i += 1) {
      h ^= slug.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 2246822507);
    h ^= h >>> 13;
    h = Math.imul(h, 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };

  const displacedHues = [];

  const assignHues = () => {
    const slugs = Object.keys(subjects).sort();
    let slots = SLOT_BASE;
    while (slugs.length > slots) slots *= 2;
    const step = 360 / slots;

    const hues = new Map();
    const used = new Set();

    for (const slug of slugs) {
      const want = subjects[slug]?.hue;
      if (!Number.isFinite(want)) continue;
      const hue = ((want % 360) + 360) % 360;
      hues.set(slug, hue);
      used.add(Math.round(hue / step) % slots);
    }

    for (const slug of slugs) {
      if (hues.has(slug)) continue;

      const want = hashOf(slug) % slots;
      if (!used.has(want)) {
        used.add(want);
        hues.set(slug, Math.round(want * step));
        continue;
      }

      let best = null;
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
          best = i;
        }
      }

      used.add(best);
      hues.set(slug, Math.round(best * step));
      displacedHues.push(slug);
    }

    return hues;
  };

  const subjectHues = assignHues();

  // Recency tiers, not a continuous scale: bitmap-era art likes discrete
  // states, and a subject visibly changing tier at a 2am publish is an event.
  // Days since the LAST fragment, not post counts — the axis tracks whether
  // the fire is lit, and must not reward binge weeks over steady writing.
  const TIERS = [
    [7, 1.0], // wrote about it this week: full burn
    [28, 0.6], // this month: dimmed
    [Infinity, 0.32], // drifting off
  ];
  const tierOf = (lastDate) => {
    if (!lastDate) return 0.32;
    const days = (Date.now() - lastDate.getTime()) / 86400000;
    return TIERS.find(([limit]) => days <= limit)[1];
  };

  // slug -> generated art, filled during the fan-out (recency needs the
  // fragments), written to the output in eleventy.after.
  const skyFiles = new Map();

  const registerSky = (slug, meta, tier) => {
    const hue = subjectHues.get(slug) ?? 0;
    const status = meta?.status ?? "active";
    skyFiles.set(`img/sky/${slug}.svg`, subjectSvg(slug, hue, status, tier));
    skyFiles.set(`img/sky/${slug}-chip.svg`, chipSvg(slug, hue, status, tier));
    return {
      skyUrl: `/img/sky/${slug}.svg`,
      chipUrl: `/img/sky/${slug}-chip.svg`,
    };
  };

  const skyUrls = new Map(); // slug -> {skyUrl, chipUrl}, for linkSubjects

  const skyTag = (slug) => {
    const art = skyUrls.get(slug);
    if (!art) return '<span class="sky sky-blank" aria-hidden="true"></span>';
    return `<span class="sky" style="background-image:url(${art.skyUrl})" aria-hidden="true"></span>`;
  };

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

  // The fan-out is memoised because the tag pages are built from exactly the
  // same slicing — a tag page is a union of subject timelines, not a second
  // pass over the posts. Cleared before every build so --serve cannot hand back
  // a page assembled from the previous edit.
  let fanOut = null;
  eleventyConfig.on("eleventy.before", () => {
    fanOut = null;
  });

  const buildSubjectPages = (api) => {
    if (fanOut) return fanOut;
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
          html: revealSpoilers(md.render(text)),
        });
      }
    }

    // A subject exists because it is registered, not because it has fragments.
    fanOut = Object.entries(subjects).map(([slug, meta]) => {
      const essay = essays.get(slug);
      const essayRaw = essay ? md.render(essay.rawInput) : null;
      const essayHtml = essayRaw === null ? null : revealSpoilers(essayRaw);

      // The blurb is Hat's own opening paragraph, not a frontmatter summary —
      // he writes the lede, nothing paraphrases it for him. Taken off the
      // REDACTED render: a blurb is plain text on a shelf, with no span to blur
      // and nothing to click.
      const firstPara =
        essayRaw === null
          ? null
          : stripSpoilers(essayRaw).match(/<p>([\s\S]*?)<\/p>/i);
      const blurb = firstPara
        ? firstPara[1].replace(/<[^>]+>/g, "").trim()
        : null;

      const fragments = collected.get(slug) ?? [];
      const tier = tierOf(fragments.at(-1)?.date ?? null);
      const art = registerSky(slug, meta, tier);
      skyUrls.set(slug, art);

      return {
        slug,
        ...meta,
        status: meta?.status ?? "active",
        ...art,
        tags: tagLinks(tagsOfSubject.get(slug)),
        fragments,
        essayHtml,
        essayDate: essay ? essay.date : null,
        hasEssay: Boolean(essay),
        blurb,
      };
    });
    return fanOut;
  };

  eleventyConfig.addCollection("subjectPages", buildSubjectPages);

  // A tag page is the subject fan-out widened: every member's fragments on one
  // timeline, oldest-first to match a subject page, each entry labelled with
  // the game it came from because unlike a subject page this one is mixed.
  //
  // A standing essay appears as its blurb plus a link rather than in full. The
  // tag page is a way in, not a second home for the writing — inlining four
  // post-mortems would bury the fragments the page exists to gather.
  //
  // A tag with no members still builds. That is the same courtesy subjects get:
  // register it now, add games as you write them, and the page fills in.
  eleventyConfig.addCollection("tagPages", (api) => {
    const bySlug = new Map(buildSubjectPages(api).map((s) => [s.slug, s]));

    return Object.entries(tags).map(([slug, meta]) => {
      const members = (meta?.members ?? [])
        .map((m) => bySlug.get(m))
        .filter(Boolean);

      const entries = [];
      for (const subject of members) {
        for (const fragment of subject.fragments) {
          entries.push({
            kind: "fragment",
            date: fragment.date,
            url: fragment.sourceUrl,
            subject,
            html: fragment.html,
          });
        }
        if (subject.hasEssay) {
          entries.push({
            kind: "essay",
            date: subject.essayDate,
            url: `/s/${subject.slug}/`,
            subject,
            blurb: subject.blurb,
          });
        }
      }
      entries.sort((a, b) => a.date - b.date);

      return {
        slug,
        title: meta?.title ?? slug,
        description: meta?.description ?? null,
        members,
        entries,
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
  const linkSubjectsHtml = (html) =>
    String(html ?? "").replace(
      /<h2([^>]*)>([\s\S]*?)<\/h2>/gi,
      (whole, attrs, inner) => {
        const slug = aliasMap.get(normalise(inner.replace(/<[^>]+>/g, "")));
        if (!slug) return whole;
        const title = subjects[slug]?.title ?? inner;
        return `<h2${attrs}><a href="/s/${slug}/">${title}</a></h2>`;
      },
    );

  // The feed keeps the plain form above — a reader has none of this stylesheet,
  // so the fragment scaffolding would arrive as dead markup. On the site each
  // section is wrapped instead, so a heading brings its sky with it.
  //
  // Safe to split on homeBody's lookahead because homeBody runs BEFORE this
  // filter: truncation still sees flat sections and still cuts on an H2.
  const FRAG_LOOSE = '<span class="sky sky-blank" aria-hidden="true"></span>';

  const wrapFragment = (sky, body) =>
    `<div class="frag">${sky}<div class="frag-body">${body}</div></div>`;

  const linkSubjectsFragments = (html) => {
    const src = String(html ?? "");
    if (!src.trim()) return src;

    const out = [];
    for (const part of src.split(/(?=<h2[\s>])/i)) {
      if (!part.trim()) continue;

      const m = /^<h2([^>]*)>([\s\S]*?)<\/h2>([\s\S]*)$/i.exec(part);
      if (!m) {
        out.push(wrapFragment(FRAG_LOOSE, part));
        continue;
      }

      const [, attrs, inner, rest] = m;
      const slug = aliasMap.get(normalise(inner.replace(/<[^>]+>/g, "")));

      // Unregistered headings stay exactly as written, but keep the column.
      if (!slug) {
        out.push(wrapFragment(FRAG_LOOSE, `<h2${attrs}>${inner}</h2>${rest}`));
        continue;
      }

      const meta = subjects[slug] ?? {};
      const title = meta.title ?? inner;
      const status = meta.status ?? "active";
      const head =
        `<h2 class="frag-head"${attrs}>` +
        `<a class="frag-subject" href="/s/${slug}/">${title}</a>` +
        `<span class="badge b-${status}">${status}</span>` +
        `</h2>`;

      out.push(wrapFragment(skyTag(slug), head + rest));
    }
    return out.join("");
  };

  eleventyConfig.addFilter("linkSubjects", linkSubjectsFragments);

  // The tag footer on a daily post: the union of the tags of every subject that
  // post files to. Read off the rendered HTML rather than the raw markdown so
  // it sees exactly the headings that became sections, with no second parser to
  // keep in step with splitSections().
  //
  // Union, so a post covering FFVII Remake and Metaphor footers as
  // "#final-fantasy #jrpg #atlus" — day-scoped, the way tags on a blog post
  // always are. Note the deliberate asymmetry with the tag page itself, which
  // is fragment-scoped: /t/atlus/ shows that post's Metaphor section alone, not
  // the whole day. The footer says what the day touched; the page shows only
  // what belongs.
  //
  // Ordered by tagviews.yaml, not by heading order, so the same pair of games
  // footers identically in every post that mentions them.
  const tagOrder = Object.keys(tags);
  eleventyConfig.addFilter("postTags", (html) => {
    const found = new Set();
    for (const [, inner] of String(html ?? "").matchAll(
      /<h2[^>]*>([\s\S]*?)<\/h2>/gi,
    )) {
      const slug = aliasMap.get(normalise(inner.replace(/<[^>]+>/g, "")));
      for (const t of tagsOfSubject.get(slug) ?? []) found.add(t);
    }
    return tagLinks(tagOrder.filter((t) => found.has(t)));
  });

  // --------------------------------------------------------------- spoilers
  //
  // ||like this|| — Discord syntax, because it is already in Hat's fingers and
  // survives a phone keyboard. Obsidian shows it as literal text, which is
  // fine: the author is not the one being protected.
  //
  // A pass over rendered HTML rather than a markdown-it inline rule, because
  // markdown-it does not treat "|" as a text terminator: its text rule swallows
  // "a ||spoiler|| b" whole, so an inline rule would only ever fire on a
  // spoiler that started a line. The pass skips <code>/<pre>, so a shell
  // "a || b" is left alone; table pipes never survive into HTML as a literal
  // "||" and need no handling.
  //
  // Two renderings of one markup, and the difference between them is the whole
  // point:
  //   site — a blurred span, revealed by focus
  //   feed — cut out entirely. A feed reader applies none of this site's CSS,
  //          and every reader sanitises unknown markup differently — several
  //          strip a wrapper and keep its contents, which fails OPEN and does
  //          it silently. Anything left in <content> is readable, so the only
  //          honest move is to not ship the words. Fixed-width, because a
  //          redaction that preserved length would leak it.
  const CODE_REGION = /(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/gi;
  const SPOILER = /\|\|([\s\S]+?)\|\|/g;

  const outsideCode = (html, fn) =>
    String(html ?? "")
      .split(CODE_REGION)
      .map((part, i) => (i % 2 ? part : fn(part)))
      .join("");

  // tabindex is what makes the span focusable, and focus is what reveals it —
  // click or tab, and the site stays at zero JavaScript.
  const revealSpoilers = (html) =>
    outsideCode(html, (s) =>
      s.replace(
        SPOILER,
        (_m, inner) => `<span class="spoiler" tabindex="0">${inner}</span>`,
      ),
    );

  const stripSpoilers = (html) =>
    outsideCode(html, (s) => s.replace(SPOILER, "[spoiler]"));

  eleventyConfig.addFilter("spoilers", revealSpoilers);

  // Feed readers resolve relative links against the feed URL, not the site, so
  // every href in feed content has to be absolute or it breaks in the reader.
  eleventyConfig.addFilter("absoluteUrls", (html, base) =>
    String(html ?? "").replace(
      /(href|src)="\/([^"]*)"/g,
      (_m, attr, rest) => `${attr}="${String(base).replace(/\/$/, "")}/${rest}"`,
    ),
  );

  // ------------------------------------------------------------------- feed
  //
  // Dated posts plus standing essays. A bare fragment-collector subject page
  // never enters the feed — that is what lets a finished essay announce itself
  // while a page that merely accumulates fragments stays quiet.
  //
  // Every entry's date is the post's OWN date and is never advanced on edit, so
  // appending to yesterday's post cannot re-notify anyone. That property is what
  // makes 2am automation safe, and it is verified by test — see the changelog.
  eleventyConfig.addCollection("feed", (api) => {
    const entries = publishable(api.getFilteredByTag("dailies")).map((p) => ({
      url: p.url,
      date: p.date,
      title: p.data.title || dateFormat.format(p.date),
      html: stripSpoilers(linkSubjectsHtml(md.render(p.rawInput))),
    }));

    for (const e of api.getFilteredByTag("essays")) {
      if (e.data.publish !== true) continue;
      if (!subjects[e.fileSlug]) continue; // no subject page => no URL to point at
      entries.push({
        url: `/s/${e.fileSlug}/`,
        date: e.date,
        title: subjects[e.fileSlug].title ?? e.data.title ?? e.fileSlug,
        html: stripSpoilers(md.render(e.rawInput)),
      });
    }

    return entries.sort((a, b) => b.date - a.date);
  });

  // The masthead's sky rolls its hue at each build — a different aurora every
  // day, held all day, zero JavaScript. Three shimmer frames of one curtain,
  // cycled by CSS.
  headerSvgs(new Date().toISOString().slice(0, 10)).forEach((svg, i) => {
    skyFiles.set(`img/aurora/h${i + 1}.svg`, svg);
  });

  // Unmatched headings are a warning, never a build failure — publishing is
  // automated at 2am and a typo must not take the site down.
  eleventyConfig.on("eleventy.after", () => {
    for (const [rel, svg] of skyFiles) {
      const dest = path.join("_site", rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, svg);
    }

    if (undated.size > 0) {
      console.warn(
        `\n[chaosh.at] ${undated.size} post(s) NOT PUBLISHED — no usable date:`,
      );
      for (const file of undated) console.warn(`  · ${file}`);
      console.warn(
        `  Rename to YYYY-MM-DD.md, or add "date: YYYY-MM-DD" to the frontmatter.\n`,
      );
    }

    // Putting membership on the tag buys one edit per tag, and costs this: a
    // members entry can name a subject that does not exist and nothing else
    // would ever say so — the game is simply absent from the view.
    const strays = Object.entries(tags).flatMap(([tag, meta]) =>
      (meta?.members ?? [])
        .filter((m) => !subjects[m])
        .map((m) => `${tag} → ${m}`),
    );
    if (strays.length > 0) {
      console.warn(
        `\n[chaosh.at] ${strays.length} tag member(s) match no subject:`,
      );
      for (const stray of strays) console.warn(`  · ${stray}`);
      console.warn(`  That subject is missing from its tag page. Check tagviews.yaml.\n`);
    }

    // Not a fault; reported because that subject's colour was decided by
    // another subject existing, and `hue:` is how to take it back.
    if (displacedHues.length > 0) {
      console.warn(
        `\n[chaosh.at] ${displacedHues.length} subject(s) moved off their preferred hue:`,
      );
      for (const slug of displacedHues) {
        console.warn(`  · ${slug} → ${subjectHues.get(slug)}deg`);
      }
      console.warn(`  Set "hue: <0-359>" in subjects.yaml to pin one.\n`);
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
