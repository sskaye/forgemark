// Types for build-cli.mjs, which tests import to rebuild the CLI bundle.
export const CLI_ENTRY: string;
export const CLI_OUT: string;
export function buildCli(opts?: { outfile?: string; write?: boolean }): Promise<Buffer>;
