# Audit

One file per human correction. This is the only channel that runs **human to agent**: the agent
writes the wiki, and this is where a human says it got something wrong.

A correction is one Markdown file with front matter locating it and a body saying what is wrong
and what is right. The audit operation applies it, appends a `# Resolution` section, and moves
the file to `resolved/`. Nothing here is ever deleted, a rejected correction included: the
rejection and its reason are the valuable part.

See `references/audit-guide.md` for the file format and the anchor strategy.
