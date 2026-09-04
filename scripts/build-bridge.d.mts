import type { BuildResult } from "esbuild";

export const BRIDGE_ENTRY: string;
export const BRIDGE_OUT: string;
export function buildBridge(options?: { outfile?: string; write?: boolean }): Promise<BuildResult>;
