// Hat's age in years, computed at build so the about page never goes stale —
// the site rebuilds every morning (deploy.yml cron), so it is never more than
// a day off. The birthdate comes from CHAOSH_BIRTHDATE (a repo secret in CI),
// never from the source: this repo is public. Unset — a local build without
// the variable — renders a visible placeholder rather than a wrong number.
// Used as {{ age }} in the vault's About.md.
export default function () {
  const raw = process.env.CHAOSH_BIRTHDATE;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw || "")) {
    console.warn("[age] CHAOSH_BIRTHDATE unset or not YYYY-MM-DD — rendering [age]");
    return "[age]";
  }
  const [y, m, d] = raw.split("-").map(Number);
  const now = new Date();
  let age = now.getUTCFullYear() - y;
  const beforeBirthday =
    now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}
