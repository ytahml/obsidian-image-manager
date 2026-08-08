# Issue tracker: GitHub

Issues and specs for this repo live as GitHub Issues. Use the `gh` CLI for all operations; infer the repository from the Git remote.

## Conventions

- Use the repository's bilingual Issue forms when applicable.
- Issue types are `bug`, `documentation`, `enhancement`, and `question`.
- Maintain priority and workflow labels manually according to the repository's existing conventions.
- Create, read, list, comment, label, and close issues with the corresponding `gh issue` commands.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.
