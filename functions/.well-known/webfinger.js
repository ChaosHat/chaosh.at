// /.well-known/webfinger — one domain, two fediverse identities.
//   @hat@chaosh.at    → GoToSocial at social.chaosh.at (account-domain chaosh.at)
//   @posts@chaosh.at  → Bridgy Fed, which bridges /feed.xml as the blog itself
// Static redirects can't branch on the query string, so this does. Both
// servers need the original ?resource= intact, so it's passed through
// verbatim. Anything unrecognized goes to GoToSocial, which answers 404 for
// names it doesn't own. The Bridgy username is set by the acct: u-url in
// base.njk's h-card — change one, change both, and never after anyone follows.
const GOTOSOCIAL = "https://social.chaosh.at";
const BRIDGY = "https://fed.brid.gy";

// Bridgy looks the site up by its URL as well as by handle, and checks the
// default @chaosh.at@chaosh.at during signup before it reads the h-card.
const BRIDGY_RESOURCES = new Set([
  "posts@chaosh.at",
  "chaosh.at@chaosh.at",
  "https://chaosh.at",
  "https://chaosh.at/",
  "http://chaosh.at",
  "http://chaosh.at/",
]);

export function onRequest({ request }) {
  const url = new URL(request.url);
  const resource = (url.searchParams.get("resource") ?? "")
    .trim()
    .toLowerCase()
    .replace(/^acct:@?/, "");
  const target = BRIDGY_RESOURCES.has(resource) ? BRIDGY : GOTOSOCIAL;
  return Response.redirect(`${target}/.well-known/webfinger${url.search}`, 302);
}
