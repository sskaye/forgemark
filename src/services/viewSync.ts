export type ViewSyncAnchor = {
  phrase: string;
  ratio: number;
};

export type TextPositionIndex = {
  text: string;
  positions: Array<number | null>;
};

export type NormalizedIndex = {
  text: string;
  positions: Array<number | null>;
};

const MARKER_RE = /<!--\s*\/?fmc:\d+\s*-->/g;
const TRAILING_BLOCK_RE = /<!--\s*forgemark-comments\b[\s\S]*?-->\s*$/;
const PHRASE_LENGTH = 96;

export function buildSourceTextIndex(text: string): NormalizedIndex {
  return buildNormalizedIndex(text, rawPositions(text.length), structuralRanges(text));
}

export function buildNormalizedIndex(
  text: string,
  positions: Array<number | null>,
  skipRanges: Array<{ from: number; to: number }> = [],
): NormalizedIndex {
  let normalized = "";
  const normalizedPositions: Array<number | null> = [];
  let pendingSpace = false;
  let pendingSpacePos: number | null = null;
  let rangeIndex = 0;

  for (let i = 0; i < text.length; i++) {
    while (rangeIndex < skipRanges.length && i >= skipRanges[rangeIndex].to) {
      rangeIndex++;
    }
    if (
      rangeIndex < skipRanges.length &&
      i >= skipRanges[rangeIndex].from &&
      i < skipRanges[rangeIndex].to
    ) {
      continue;
    }

    const ch = text[i];
    const pos = positions[i] ?? null;
    if (/\s/.test(ch)) {
      if (normalized.length > 0) {
        pendingSpace = true;
        if (pendingSpacePos == null && pos != null) pendingSpacePos = pos;
      }
      continue;
    }
    if (pendingSpace && normalized.length > 0) {
      normalized += " ";
      normalizedPositions.push(pendingSpacePos);
      pendingSpace = false;
      pendingSpacePos = null;
    }
    normalized += ch.toLowerCase();
    normalizedPositions.push(pos);
  }

  return { text: normalized.trimEnd(), positions: normalizedPositions };
}

export function makeAnchorFromIndex(
  index: NormalizedIndex,
  sourcePosition: number | null,
  ratio: number,
): ViewSyncAnchor | null {
  if (index.text.length === 0) return { phrase: "", ratio };
  let start = 0;
  if (sourcePosition != null) {
    const found = index.positions.findIndex((pos) => pos != null && pos >= sourcePosition);
    start = found >= 0 ? found : Math.max(0, index.text.length - PHRASE_LENGTH);
  }
  const phrase = wordBoundedSlice(index.text, start, PHRASE_LENGTH);
  return { phrase, ratio };
}

export function findAnchorPosition(index: NormalizedIndex, anchor: ViewSyncAnchor): number | null {
  const phrase = anchor.phrase.trim();
  if (phrase.length === 0) return null;
  const at = index.text.indexOf(phrase);
  if (at < 0) return null;
  return index.positions[at] ?? nearestPosition(index.positions, at);
}

export function scrollPaneToRatio(pane: HTMLElement, ratio: number): void {
  const max = Math.max(0, pane.scrollHeight - pane.clientHeight);
  pane.scrollTop = max * clampRatio(ratio);
}

export function scrollRatio(pane: HTMLElement): number {
  const max = pane.scrollHeight - pane.clientHeight;
  if (max <= 0) return 0;
  return clampRatio(pane.scrollTop / max);
}

function rawPositions(length: number): number[] {
  return Array.from({ length }, (_, i) => i);
}

function structuralRanges(text: string): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  for (const m of text.matchAll(MARKER_RE)) {
    const from = m.index ?? 0;
    ranges.push({ from, to: from + m[0].length });
  }
  const trailing = text.match(TRAILING_BLOCK_RE);
  if (trailing && typeof trailing.index === "number") {
    ranges.push({ from: trailing.index, to: trailing.index + trailing[0].length });
  }
  return ranges.sort((a, b) => a.from - b.from || a.to - b.to);
}

function wordBoundedSlice(text: string, start: number, targetLength: number): string {
  let from = Math.max(0, start);
  while (from > 0 && text[from - 1] !== " ") from--;
  let to = Math.min(text.length, from + targetLength);
  while (to < text.length && text[to] !== " ") to++;
  return text.slice(from, to).trim();
}

function nearestPosition(positions: Array<number | null>, start: number): number | null {
  for (let i = start; i < positions.length; i++) {
    if (positions[i] != null) return positions[i];
  }
  for (let i = start - 1; i >= 0; i--) {
    if (positions[i] != null) return positions[i];
  }
  return null;
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
