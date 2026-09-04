// forgemark — read, add, and answer review comments in a Forgemark file.
//
// The command-line surface of the single-file bundle that ships inside
// the Forgemark skill (`main.ts` is the two-line entry point). An agent
// runs it instead of editing the comments block by hand: every write
// goes through the app's own parser and serializer, is read back before
// it is written, and is written atomically. The argument parsing is
// hand-rolled so the bundle carries no dependency beyond the format
// layer itself.

import { serializeForgemarkFile, ForgemarkSerializeError } from "../src/format/serializer";
import { parseForgemarkFile, ForgemarkParseError } from "../src/format/parser";
import type { DocFormat, ParsedFile } from "../src/format/types";
import { readSource, writeAtomic, readStdin, nowIso, IoError } from "./io";
import {
  addComment,
  addReply,
  setResolved,
  deleteComment,
  floatComment,
  reattachComment,
  listComments,
  CommandError,
  type Listed,
  type Result,
} from "./lib";
import { lintText, type Problem } from "./lint";

const VERSION = typeof __FORGEMARK_VERSION__ === "string" ? __FORGEMARK_VERSION__ : "dev";

// Exit codes: 0 done, 1 the file has problems (lint) or the request was
// refused, 2 usage, 3 the file couldn't be read or written.
const EXIT_OK = 0;
const EXIT_PROBLEM = 1;
const EXIT_USAGE = 2;
const EXIT_IO = 3;

const USAGE = `forgemark ${VERSION} — review comments in Forgemark files (.md and .html)

Usage:
  forgemark list <file> [--unresolved] [--orphaned] [--json]
  forgemark show <file> <id> [--json]
  forgemark comment <file> --anchor "passage" [--occurrence N] --body "…"
  forgemark comment <file> --anchor "passage" --suggest "replacement" [--body "…"]
  forgemark comment <file> --selector "#fig-3" --body "…"        (HTML: whole element)
  forgemark comment <file> --floating --body "…"                  (no anchor)
  forgemark reply <file> <id> --body "…"
  forgemark resolve | unresolve | delete | float <file> <id>
  forgemark reattach <file> <id> --anchor "passage" | --selector "#id"
  forgemark lint <file>... [--strict] [--json]

Options:
  --author NAME       Who is writing. Required for comment and reply, or set FORGEMARK_AUTHOR.
  --body TEXT         Comment or reply text. --body-file PATH reads a file; --body-file - reads stdin.
  --anchor TEXT       The passage to attach to, quoted as a reader sees it. Whitespace and
                      inline formatting are ignored when matching. Must match exactly once,
                      or add --occurrence N.
  --selector SEL      HTML only: wrap a whole element by id ("#fig-3" or "#fig-3 table").
  --suggest TEXT      Make the comment a suggested edit replacing the anchored text.
  --json              Machine-readable output.
  --strict            lint: treat warnings as errors.

Every write is parsed back before the file is replaced; nothing is written if it would not
read back. Exit codes: 0 ok, 1 refused or lint problems, 2 usage, 3 I/O.
`;

type Flags = Record<string, string | boolean | undefined>;
type Parsed = { command: string; positional: string[]; flags: Flags };

const VALUE_FLAGS = new Set([
  "author",
  "body",
  "body-file",
  "anchor",
  "selector",
  "occurrence",
  "suggest",
]);
const BOOL_FLAGS = new Set([
  "json",
  "floating",
  "unresolved",
  "resolved",
  "orphaned",
  "strict",
  "help",
  "version",
]);

class UsageError extends Error {}

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    if (BOOL_FLAGS.has(name)) {
      if (eq >= 0) throw new UsageError(`--${name} takes no value.`);
      flags[name] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) throw new UsageError(`Unknown option --${name}.`);
    if (eq >= 0) {
      flags[name] = arg.slice(eq + 1);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined) throw new UsageError(`--${name} needs a value.`);
    flags[name] = value;
    i++;
  }
  const [command = "", ...rest] = positional;
  return { command, positional: rest, flags };
}

function str(flags: Flags, name: string): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}

function needAuthor(flags: Flags): string {
  const author = str(flags, "author") ?? process.env.FORGEMARK_AUTHOR;
  if (!author || !author.trim()) {
    throw new UsageError("--author is required (or set FORGEMARK_AUTHOR).");
  }
  return author.trim();
}

function bodyText(flags: Flags): string | undefined {
  const inline = str(flags, "body");
  const fromFile = str(flags, "body-file");
  if (inline !== undefined && fromFile !== undefined) {
    throw new UsageError("Give --body or --body-file, not both.");
  }
  if (inline !== undefined) return inline;
  if (fromFile === "-") return readStdin();
  if (fromFile !== undefined) return readSource(fromFile).text;
  return undefined;
}

function needId(positional: string[], at: number): number {
  const raw = positional[at];
  if (raw === undefined || !/^\d+$/.test(raw)) {
    throw new UsageError("Expected a comment id (a positive integer).");
  }
  return Number(raw);
}

function needFile(positional: string[]): string {
  const file = positional[0];
  if (!file) throw new UsageError("Expected a file path.");
  return file;
}

function occurrence(flags: Flags): number | undefined {
  const raw = str(flags, "occurrence");
  if (raw === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(raw)) throw new UsageError("--occurrence must be a positive integer.");
  return Number(raw);
}

// ── loading and saving ────────────────────────────────────────────────

type Doc = { path: string; format: DocFormat; text: string; file: ParsedFile };

// A write command refuses a file the app could not read cleanly. The
// alternative — operating on a recovered approximation and writing it
// back — would silently change the reviewer's file in ways they did not
// ask for. `lint` says what is wrong.
function loadDocument(path: string): Doc {
  const source = readSource(path);
  try {
    const file = parseForgemarkFile(source.text, { tolerant: true, format: source.format });
    return { ...source, file };
  } catch (err) {
    if (err instanceof ForgemarkParseError) {
      throw new CommandError(
        `${path} could not be read: ${err.message}\nRun \`forgemark lint ${path}\` for the full list, and repair the file before writing to it.`,
      );
    }
    throw err;
  }
}

function saveDocument(doc: Doc, result: Result): void {
  let text: string;
  try {
    text = serializeForgemarkFile(result.file);
  } catch (err) {
    if (err instanceof ForgemarkSerializeError) throw new CommandError(err.message);
    throw err;
  }
  // The serializer already parsed its own block back; this re-reads the
  // whole file as the app will, markers included.
  try {
    parseForgemarkFile(text, { tolerant: true, format: doc.format });
  } catch (err) {
    throw new CommandError(
      `Refusing to write: the result would not read back (${(err as Error).message}). Nothing was changed.`,
    );
  }
  writeAtomic(doc.path, text);
}

// ── output ────────────────────────────────────────────────────────────

function printList(doc: Doc, entries: Listed[], flags: Flags): void {
  let shown = entries;
  if (flags.unresolved) shown = shown.filter((e) => !e.comment.resolved);
  if (flags.resolved) shown = shown.filter((e) => e.comment.resolved);
  if (flags.orphaned) shown = shown.filter((e) => e.status === "orphaned");

  if (flags.json) {
    console.log(
      JSON.stringify({ file: doc.path, format: doc.format, comments: shown.map(toJson) }, null, 2),
    );
    return;
  }
  if (shown.length === 0) {
    console.log(entries.length === 0 ? "No comments." : "No comments match the filter.");
    return;
  }
  for (const e of shown) {
    const c = e.comment;
    const kind = c.suggested_edit ? "suggestion" : c.floating ? "note" : "comment";
    const state = c.resolved ? "resolved" : "open";
    const head = [`#${c.id}`, kind, state, e.status, c.author, c.timestamp.slice(0, 10)].join("  ");
    console.log(head);
    if (c.anchor_text) console.log(`    on: ${quote(c.anchor_text)}`);
    if (c.suggested_edit) {
      console.log(`    suggests: ${quote(c.suggested_edit.from)} → ${quote(c.suggested_edit.to)}`);
    }
    if (c.body) console.log(`    ${firstLine(c.body)}`);
    const n = c.replies?.length ?? 0;
    if (n > 0) {
      const last = c.replies![n - 1];
      console.log(
        `    ${n} ${n === 1 ? "reply" : "replies"}, last by ${last.author}: ${firstLine(last.body)}`,
      );
    }
  }
}

function printShow(doc: Doc, entry: Listed, flags: Flags): void {
  if (flags.json) {
    console.log(
      JSON.stringify({ file: doc.path, format: doc.format, comment: toJson(entry) }, null, 2),
    );
    return;
  }
  const c = entry.comment;
  const kind = c.suggested_edit ? "Suggestion" : c.floating ? "Floating note" : "Comment";
  console.log(
    `${kind} #${c.id} by ${c.author} at ${c.timestamp} — ${c.resolved ? "resolved" : "open"}, ${entry.status}`,
  );
  if (c.anchor_text !== undefined) console.log(`Anchor: ${quote(c.anchor_text)}`);
  if (entry.current !== undefined && entry.current.replace(/\s+/g, " ").trim() !== c.anchor_text) {
    console.log(`Currently between the markers: ${quote(entry.current)}`);
  }
  if (c.anchor_selector) console.log(`Selector: ${c.anchor_selector}`);
  if (c.context_before) console.log(`  before: ${c.context_before}`);
  if (c.context_after) console.log(`  after:  ${c.context_after}`);
  if (c.suggested_edit) {
    console.log(`Suggested edit: ${quote(c.suggested_edit.from)} → ${quote(c.suggested_edit.to)}`);
  }
  if (c.body) console.log(`\n${c.body.trimEnd()}`);
  for (const r of c.replies ?? []) {
    console.log(`\nReply by ${r.author} at ${r.timestamp}${r.edited_at ? " (edited)" : ""}:`);
    console.log(r.body.trimEnd());
  }
}

function toJson(e: Listed): Record<string, unknown> {
  const { additionalKeys, ...rest } = e.comment;
  const out: Record<string, unknown> = { ...rest, ...(additionalKeys ?? {}), status: e.status };
  if (e.current !== undefined) out.current_text = e.current;
  return out;
}

function quote(s: string): string {
  return JSON.stringify(s.replace(/\s+/g, " ").trim());
}

function firstLine(s: string, max = 110): string {
  const line = s.split("\n").find((l) => l.trim().length > 0) ?? "";
  return line.length > max ? line.slice(0, max - 1).trimEnd() + "…" : line;
}

function printLint(path: string, report: ReturnType<typeof lintText>, strict: boolean): number {
  const errors = report.problems.filter((p) => p.severity === "error").length;
  const warnings = report.problems.length - errors;
  for (const p of report.problems) console.log(formatProblem(path, p));
  const c = report.counts;
  const tally = report.file
    ? `${c.comments} comment${c.comments === 1 ? "" : "s"} (${c.attached} attached, ${c.orphaned} orphaned, ${c.floating} floating)`
    : "unreadable";
  const verdict =
    errors > 0 ? "FAIL" : warnings > 0 ? (strict ? "FAIL" : "OK with warnings") : "OK";
  console.log(`${path}: ${verdict} — ${tally}, ${errors} error(s), ${warnings} warning(s)`);
  return errors > 0 || (strict && warnings > 0) ? EXIT_PROBLEM : EXIT_OK;
}

function formatProblem(path: string, p: Problem): string {
  const where = p.line !== undefined ? `${path}:${p.line}` : path;
  return `${where}: ${p.severity}: ${p.message}`;
}

// ── commands ──────────────────────────────────────────────────────────

function run(argv: string[]): number {
  const { command, positional, flags } = parseArgs(argv);
  if (flags.version) {
    console.log(VERSION);
    return EXIT_OK;
  }
  if (flags.help || command === "" || command === "help") {
    process.stdout.write(USAGE);
    return command === "" && !flags.help ? EXIT_USAGE : EXIT_OK;
  }

  switch (command) {
    case "list": {
      const doc = loadDocument(needFile(positional));
      printList(doc, listComments(doc.file, doc.format), flags);
      return EXIT_OK;
    }
    case "show": {
      const doc = loadDocument(needFile(positional));
      const id = needId(positional, 1);
      const entry = listComments(doc.file, doc.format).find((e) => e.comment.id === id);
      if (!entry) throw new CommandError(`No comment #${id} in ${doc.path}.`);
      printShow(doc, entry, flags);
      return EXIT_OK;
    }
    case "comment": {
      const doc = loadDocument(needFile(positional));
      const result = addComment(doc.file, doc.format, {
        author: needAuthor(flags),
        body: bodyText(flags),
        anchor: str(flags, "anchor"),
        selector: str(flags, "selector"),
        floating: flags.floating === true,
        occurrence: occurrence(flags),
        suggest: str(flags, "suggest"),
        now: nowIso(),
      });
      saveDocument(doc, result);
      report(result, flags);
      return EXIT_OK;
    }
    case "reply": {
      const doc = loadDocument(needFile(positional));
      const id = needId(positional, 1);
      const body = bodyText(flags);
      if (body === undefined) throw new UsageError("A reply needs --body or --body-file.");
      const result = addReply(doc.file, id, { author: needAuthor(flags), body, now: nowIso() });
      saveDocument(doc, result);
      report(result, flags);
      return EXIT_OK;
    }
    case "resolve":
    case "unresolve": {
      const doc = loadDocument(needFile(positional));
      const result = setResolved(doc.file, needId(positional, 1), command === "resolve");
      saveDocument(doc, result);
      report(result, flags);
      return EXIT_OK;
    }
    case "delete": {
      const doc = loadDocument(needFile(positional));
      const result = deleteComment(doc.file, needId(positional, 1));
      saveDocument(doc, result);
      report(result, flags);
      return EXIT_OK;
    }
    case "float": {
      const doc = loadDocument(needFile(positional));
      const result = floatComment(doc.file, needId(positional, 1));
      saveDocument(doc, result);
      report(result, flags);
      return EXIT_OK;
    }
    case "reattach": {
      const doc = loadDocument(needFile(positional));
      const result = reattachComment(doc.file, doc.format, needId(positional, 1), {
        anchor: str(flags, "anchor"),
        selector: str(flags, "selector"),
        occurrence: occurrence(flags),
      });
      saveDocument(doc, result);
      report(result, flags);
      return EXIT_OK;
    }
    case "lint": {
      if (positional.length === 0) throw new UsageError("Expected one or more file paths.");
      let worst = EXIT_OK;
      const reports = positional.map((path) => {
        const source = readSource(path);
        return { path, report: lintText(source.text, source.format) };
      });
      if (flags.json) {
        console.log(JSON.stringify(reports, null, 2));
        for (const { report: r } of reports) {
          const errors = r.problems.some((p) => p.severity === "error");
          const warnings = r.problems.some((p) => p.severity === "warning");
          if (errors || (flags.strict && warnings)) worst = EXIT_PROBLEM;
        }
        return worst;
      }
      for (const { path, report: r } of reports) {
        worst = Math.max(worst, printLint(path, r, flags.strict === true));
      }
      return worst;
    }
    default:
      throw new UsageError(`Unknown command "${command}".`);
  }
}

function report(result: Result, flags: Flags): void {
  if (flags.json) {
    console.log(JSON.stringify({ ok: true, id: result.id, summary: result.summary }));
  } else {
    console.log(result.summary);
  }
}

export function main(argv: string[]): number {
  try {
    return run(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`forgemark: ${err.message}\nRun \`forgemark --help\` for usage.`);
      return EXIT_USAGE;
    }
    if (err instanceof CommandError) {
      console.error(`forgemark: ${err.message}`);
      return EXIT_PROBLEM;
    }
    if (err instanceof IoError) {
      console.error(`forgemark: ${err.message}`);
      return EXIT_IO;
    }
    console.error(`forgemark: unexpected error: ${(err as Error).stack ?? String(err)}`);
    return EXIT_IO;
  }
}
