// Types for latest-json.mjs, which tests import.
export type UpdatePlatform = { signature: string; url: string };
export type LatestJson = {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, UpdatePlatform>;
};
export function updateAssets(version: string): Record<string, string[]>;
export function buildLatestJson(input: {
  version: string;
  notes: string;
  pubDate: string;
  signatures: Record<string, string>;
}): LatestJson;
export function changelogSection(changelog: string, version: string): string;
