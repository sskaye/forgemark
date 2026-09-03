#!/usr/bin/env node
// Entry point of the forgemark CLI. Everything lives in run.ts so tests
// can call `main(argv)` without triggering a run at import time.
import { main } from "./run";

process.exitCode = main(process.argv.slice(2));
