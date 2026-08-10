export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addPassthroughCopy({ "src/CNAME": "CNAME" });

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

  // The excerpt is everything above the first H2 — i.e. the prose that stays
  // with the daily post and is never filed out to a subject page. If a post
  // opens straight into a subject, fall back to its first paragraph.
  eleventyConfig.addFilter("excerpt", (html) => {
    if (!html) return "";
    const above = html.split(/<h2[\s>]/i)[0].trim();
    if (above) return above;
    const firstPara = html.match(/<p>[\s\S]*?<\/p>/i);
    return firstPara ? firstPara[0] : "";
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

  eleventyConfig.addCollection("dailies", (api) =>
    api
      .getFilteredByTag("dailies")
      .filter((p) => !p.data.hold)
      .sort((a, b) => b.date - a.date),
  );

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
