// YAML front matter, split off before the body reaches an editor that
// has no idea what it is. Markdown editors read `---` as a thematic
// break and `key: value` under it as a setext heading, so a document
// that carried front matter came back with its header turned into an
// H2. Everything that hands the body to the editor takes the rest, and
// everything that takes the body back prepends the front matter as it
// was.

// The blank lines after the closing fence go with it: the editor drops
// leading blank lines from what it is given, so they must never reach it.
const FRONT_MATTER_RE = /^---\r?\n(?:[\s\S]*?\r?\n)?---\r?\n(?:\r?\n)*/;

export type SplitBody = { front: string; rest: string };

export function splitFrontmatter(body: string): SplitBody {
  const m = FRONT_MATTER_RE.exec(body);
  if (!m) return { front: "", rest: body };
  return { front: m[0], rest: body.slice(m[0].length) };
}
