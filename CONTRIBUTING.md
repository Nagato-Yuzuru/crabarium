# Contributing

## Set up

You need [mise](https://mise.jdx.dev/). It installs Node, pnpm, actionlint, prek, and git-cliff at the versions in `mise.toml`. `mise.lock` records the checksum of each download.

```sh
mise trust
mise install
pnpm install
```

`mise install` also runs `prek install`, which installs the git hooks from `prek.toml`. Each new worktree needs `mise trust` again, because mise trusts a config file by its path.

## Run the mod

```sh
pnpm dev
```

This starts Claude Code with the mod loaded from this folder. The session reloads the mod when you save a file. The engine also writes the API types to `.claude-plugin/types/`. `pnpm check` needs these types for the type check and the type-aware lint rules, so run `pnpm dev` once first. Without them, it skips those and says so.

## Commands

| Command         | What it does                                                                        |
| --------------- | ----------------------------------------------------------------------------------- |
| `pnpm gen`      | Writes `schema/pack.schema.json` and `hooks/packs.generated.ts`.                    |
| `pnpm check`    | Runs `vp check` (format, lint, and type check), actionlint, and `pnpm gen --check`. |
| `pnpm fix`      | Formats the files and applies the safe lint fixes (`vp check --fix`).               |
| `pnpm validate` | Reads the mod as the engine does and reports what it refuses.                       |
| `pnpm test`     | Runs the `*.test.ts` files against the engine.                                      |
| `pnpm verify`   | Runs all of the above checks.                                                       |

The engine version for `dev`, `validate`, and `test` is the `@anthropic-ai/claude-code` version in `package.json`. Keep it equal to or later than `MIN_ENGINE_VERSION` in `hooks/core/version.ts`.

## Git hooks

prek runs the hooks in `prek.toml`. The hooks take the tools from `PATH`, so run git from a shell where mise is active. The hooks check and do not change files. Run `pnpm fix` to fix what they report.

- `pre-commit` runs `vp check` on the staged files, and actionlint on the staged workflow files. It also runs prek built-in checks: merge conflict markers, large files, private keys, and YAML and TOML syntax.
- `commit-msg` uses git-cliff to require a [Conventional Commits](https://www.conventionalcommits.org/) message. The types are the ones in the `commit_parsers` of `cliff.toml`. Mark a breaking change with `!`.
- `pre-push` runs `pnpm verify`.

CI runs the same checks, but without the type check and the type-aware lint rules: the engine writes the types only when an interactive session loads the mod.

On a pull request, the `autofix.ci` workflow runs `vp fmt` and `vp lint --fix`, and the autofix.ci app pushes the result to the pull request as one commit.

## Changelog

`cliff.toml` configures git-cliff. `git cliff` prints the changelog from the commit history, and `git cliff -o CHANGELOG.md` writes it to a file.

## Dependency updates

Renovate updates the npm packages, the tools in `mise.toml` and `mise.lock`, and the GitHub Actions digests. It waits 7 days after a release, as `pnpm-workspace.yaml` and `mise.toml` do. `@anthropic-ai/claude-code` has no wait. An update of it does not change `MIN_ENGINE_VERSION`: change that by hand when the mod needs a newer engine.

## Character packs

The pack format has one source: the JSON Schema object in `hooks/core/pack/schema.ts`. After you change it, or a file in `packs/`, run `pnpm gen`. `pnpm check` fails when a generated file is out of date. It also runs each fixture in `tests/fixtures/packs.ts` through Ajv, so the published schema and the mod's own validator must agree.

The roles (`ROLES` in `hooks/core/pack/schema.ts`) are a closed set. A pack maps the roles that it has art for, the keyword and type tables in `hooks/core/avatar/select.ts` give a role, and a classifier will choose one of them. To add or remove a role is a pack format change: update the schema, the tables, and the built-in packs together.

## Context windows

`hooks/core/usage/models.ts` holds the context window of each model, for a subagent's context percent. Its header names the source page and the date that it was read. Nothing updates the table automatically. When Anthropic adds a model, read the page, change the rows and the date, and run `pnpm test`. A model that is not in the table shows `?`, so an old table never shows a wrong number for a new model.

The pane shows no cost for a single agent. The engine gives only the session total, and an estimate from list prices can be far off.
