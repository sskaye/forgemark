const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

export function normalizeExternalUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return EXTERNAL_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
