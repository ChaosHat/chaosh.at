// Parity harness for the Python <-> JS mirror contracts. Not part of the
// site build — run by .claude/scripts/test_parity.py (vault side), which
// feeds fixture JSON on stdin and diffs this output against the Python
// implementations in chaosh_subjects.py.
//
// The contracts under test, each marked "if one changes, change both":
//   normalise()      heading/alias matching
//   essaySlug()      essay filename -> /e/ URL
//   imageSafeName()  published image filename
//   IMAGE_EXT        what counts as an image embed
//   splitSections()  the ## fan-out boundary
//   about: parsing   js-yaml here vs the hand parse in parse_about()
import fs from "node:fs";
import { load as parseYaml } from "js-yaml";
import {
  IMAGE_EXT,
  essaySlug,
  imageSafeName,
  normalise,
  splitSections,
} from "./eleventy.config.js";

const input = JSON.parse(fs.readFileSync(0, "utf8"));

// Mirrors resolveAbout()'s intake: frontmatter arrives as a list or a bare
// scalar, each value goes through String().trim() before resolution.
const aboutValues = (fm) => {
  const data = parseYaml(fm) ?? {};
  const raw = data.about == null ? [] : [].concat(data.about);
  return raw.map((v) => String(v).trim()).filter(Boolean);
};

process.stdout.write(
  JSON.stringify({
    normalise: input.normalise.map(normalise),
    essaySlug: input.essaySlug.map(essaySlug),
    imageSafeName: input.imageSafeName.map(imageSafeName),
    imageExt: input.imageExt.map((n) => IMAGE_EXT.test(n)),
    about: input.about.map(aboutValues),
    sections: input.sections.map((body) =>
      splitSections(body).map((s) => s.heading),
    ),
  }),
);
