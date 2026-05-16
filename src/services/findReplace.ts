export type TextMatch = {
  from: number;
  to: number;
};

export function findLiteralMatches(text: string, query: string, matchCase = false): TextMatch[] {
  if (query.length === 0) return [];
  const haystack = matchCase ? text : text.toLocaleLowerCase();
  const needle = matchCase ? query : query.toLocaleLowerCase();
  if (needle.length === 0) return [];
  const out: TextMatch[] = [];
  let index = 0;
  while (index <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, index);
    if (at === -1) break;
    out.push({ from: at, to: at + needle.length });
    index = at + Math.max(needle.length, 1);
  }
  return out;
}
