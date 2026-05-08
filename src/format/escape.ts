// Escape rules for user-content fields (body, anchor_text, context_before,
// context_after). The trailing comments block is wrapped in a single HTML
// comment, so the literal sequences `-->` and `<!--` would terminate or
// break the wrapper if they appeared in user content. We escape them
// symmetrically:
//
//   -->  →  --\>
//   <!-- →  <!\--
//
// The order matters on parse — we restore `<!--` first so that an escaped
// `--\>` doesn't accidentally chain with a `<` that follows. (Concretely:
// the patterns don't overlap, but we keep the order consistent with the
// serialize step.)

const SERIALIZE_PAIRS: [RegExp, string][] = [
  [/-->/g, "--\\>"],
  [/<!--/g, "<!\\--"],
];

const PARSE_PAIRS: [RegExp, string][] = [
  [/<!\\--/g, "<!--"],
  [/--\\>/g, "-->"],
];

export function escapeContent(input: string): string {
  let out = input;
  for (const [pat, rep] of SERIALIZE_PAIRS) out = out.replace(pat, rep);
  return out;
}

export function unescapeContent(input: string): string {
  let out = input;
  for (const [pat, rep] of PARSE_PAIRS) out = out.replace(pat, rep);
  return out;
}
