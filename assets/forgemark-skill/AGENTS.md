# Forgemark agent bundle

This is a Forgemark skill package. The instructions live in [`SKILL.md`](SKILL.md). Read that file before touching a Forgemark document.

In short: Forgemark stores inline review comments inside ordinary `.md` and `.html` files using two structural elements — paired HTML-comment markers around anchored passages, and a single trailing YAML block listing the comments. Both humans and AI agents author and respond to comments as peers.

Use the bundled tool for every read and write of comments — `node scripts/forgemark.mjs --help` (Node 18+) — rather than editing the comments block by hand. It is built from the app's own parser and serializer and refuses to write anything the app could not read.

If the tooling you are running on reads `AGENTS.md` but not `SKILL.md`, treat that as a configuration gap — the canonical instructions are in `SKILL.md` and a partial reading will produce broken files.
