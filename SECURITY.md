# Security

Forgemark opens documents other people wrote, and draws them: Markdown with embedded HTML, Mermaid diagrams and math, and whole HTML reports with their own scripts. A document that can run code outside its sandbox, read or write files it shouldn't, or reach the network unasked is a security problem, and so is anything else that lets a file or a link do more than a reader expects.

## Supported versions

Security fixes go into the latest release. The app offers each update itself (Settings → Updates); the command-line tool is updated by downloading the new release's `forgemark-cli-<version>.mjs`.

## Reporting a vulnerability

Please report it privately, through the repository's [Security tab](https://github.com/sskaye/forgemark/security/advisories/new), not in a public issue or discussion. Say what's affected, how to reproduce it (a file that shows it is best), and what it lets someone do.

You'll get a reply there within a week. Once a fix is ready it's released, and the advisory is published with it, crediting you unless you'd rather not be named.
