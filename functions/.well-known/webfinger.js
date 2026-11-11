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

// Browser-based fediverse clients fetch this cross-origin, and a redirect is
// only followed if the redirect response itself passes the CORS check. The
// target (GoToSocial, Bridgy Fed) has to answer with its own CORS header too.
const CORS = { "Access-Control-Allow-Origin": "*" };

export function onRequest({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS,
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  const url = new URL(request.url);
  const resource = (url.searchParams.get("resource") ?? "")
    .trim()
    .toLowerCase()
    .replace(/^acct:@?/, "");
  const target = BRIDGY_RESOURCES.has(resource) ? BRIDGY : GOTOSOCIAL;
  // Response.redirect() returns immutable headers, so build the 302 by hand.
  return new Response(null, {
    status: 302,
    headers: {
      ...CORS,
      Location: `${target}/.well-known/webfinger${url.search}`,
    },
  });
}
