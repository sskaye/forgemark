# Forgemark agent bundle

This is a Forgemark skill package. The full format spec lives in [`SKILL.md`](SKILL.md). Read that file before making any edit to a Forgemark document.

In short: Forgemark stores inline review comments inside ordinary `.md` files using two structural elements — paired HTML-comment markers around anchored passages, and a single trailing YAML block listing the comments. Both humans and AI agents author and respond to comments as peers.

If the tooling you are running on reads `AGENTS.md` but not `SKILL.md`, treat that as a configuration gap — the canonical instructions are in `SKILL.md` and a partial reading will produce broken files.
