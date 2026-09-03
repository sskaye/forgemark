// Types for build-cli.mjs, which tests import to rebuild the CLI bundle.
import type { BuildResult } from "esbuild";

export const CLI_ENTRY: string;
export const CLI_OUT: string;
export function buildCli(opts?: { outfile?: string; write?: boolean }): Promise<BuildResult>;
