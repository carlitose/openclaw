# Wiki Schema

## Page Types

| Type | Directory | Purpose |
|------|-----------|---------|
| entity | wiki/entities/ | Named things: people, tools, organisations, datasets |
| concept | wiki/concepts/ | Ideas, techniques, phenomena, frameworks |
| source | wiki/sources/ | Ingested material: papers, articles, repository docs, sessions |
| query | wiki/queries/ | Open questions under active investigation |
| comparison | wiki/comparisons/ | Side-by-side analysis of related entities |
| synthesis | wiki/synthesis/ | Cross-cutting summaries and conclusions |
| lifecycle | wiki/timeline/tickets/ | One record per ticket: disposition, dates, provenance |
| period | wiki/timeline/ | One page per period in which something happened |

## Naming Conventions

- Files: `kebab-case.md`
- Entities: the official name where one exists
- Concepts: descriptive noun phrases
- A page compiled from a project artefact is named from the artefact's **identity**, never from
  its path, so moving the artefact updates the page instead of creating a second one

## Frontmatter

Every page carries YAML front matter. **Values are flat scalars or lists of scalars.** A nested
map survives on disk but is read back by the LLM Wiki application as a single JSON string, so
compound information travels as sibling keys.

```yaml
---
type: entity | concept | source | query | comparison | synthesis | lifecycle | period
title: Human-readable title
tags: []
related: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

A page compiled from a project artefact also carries:

```yaml
identity_key: ticket:<folder>/<ticket_id> | artifact:<id> | path:<repo-relative-path>
identity_strength: stable | weak
source_path: <repo-relative-path>
source_digest: sha256:<hex>
source_status: present | missing
disposition: open | completed | canceled | on-hold | not-applicable
created_provenance: git-rename | git-commit | frontmatter | session-observed | mtime | unknown
disposition_changed_provenance: <the same set>
```

**Every date carries the rung that produced it.** A date without provenance is not a date this
wiki will state, and an unresolved date is written as unknown rather than as a plausible value.

## Index Format

`wiki/index.md` lists every page grouped by type, each exactly once:

```
- [[sources/<page-slug>]] — one-line description
```

## Log Format

`wiki/log.md` records operations newest first:

```
## YYYY-MM-DD

- HH:MM <op> — <one line: what changed, and how many pages>
```

## Cross-referencing Rules

- Link with `[[page-slug]]`.
- Every page appears in `wiki/index.md` exactly once; lint enforces it.
- A lifecycle record links the sessions that named its ticket, and each links back.

## Contradiction Handling

When sources disagree:

1. Note the contradiction on the relevant concept or entity page.
2. Open or update a query page to track it.
3. Link both sources from the query page.
4. Resolve in a synthesis page once the evidence supports one reading.

A **human correction** is a different thing from a contradiction between sources. It goes in
`audit/`, where the audit operation applies it and archives the file to `audit/resolved/`.
