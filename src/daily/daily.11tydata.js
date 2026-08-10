// A daily post's date is its identity: it sets the URL and the feed's sort key.
// It must come from the YYYY-MM-DD filename or an explicit `date:` — never from
// file creation time, which the CI checkout resets on every deploy. An undated
// post would silently re-date itself each build and resurface in the feed
// forever, so it is excluded from the site and reported instead.

const DATE_FILENAME = /^\d{4}-\d{2}-\d{2}$/;

const isDated = (data) =>
  DATE_FILENAME.test(data.page.fileSlug) || Boolean(data.date);

export default {
  layout: "post.njk",
  tags: "dailies",
  isDaily: true,
  eleventyComputed: {
    datedProperly: (data) => isDated(data),
    permalink: (data) =>
      isDated(data)
        ? `/daily/${data.page.date.toISOString().slice(0, 10)}/`
        : false,
  },
};
