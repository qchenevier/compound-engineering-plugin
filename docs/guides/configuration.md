# Compound Engineering configuration

Compound Engineering reads optional defaults from repo-local, repo-tracked, and personal config layers. A repository can commit team defaults in `.compound-engineering/config.yaml`, each checkout can override them in `.compound-engineering/config.local.yaml`, and a person can keep lowest-precedence defaults in `~/.compound-engineering/config.yaml`.

Run `/ce-setup` to create the repo `config.yaml` and refresh the committed `.compound-engineering/config.example.yaml`. Setup does not create `config.local.yaml` or the personal file. Uncomment only the keys you want to change. Do not put credentials, CLI commands, or harness flags in these files.

## How keys resolve

- **Ordinary keys:** read repo `.compound-engineering/config.local.yaml`, then repo `.compound-engineering/config.yaml`, then `~/.compound-engineering/config.yaml`. The first active (non-commented) value wins. A missing or unreadable layer is skipped. Invalid or empty scalars continue to the next layer, then the skill default. A present list or map, including empty, replaces the whole key; layers are not deep-merged.
- **`docs_root`:** read only from repo `config.yaml`. Values in `config.local.yaml` or the personal file are ignored.
- **`packs`:** read only from the two repo files, whose lists concatenate. A `packs` entry in the personal file is ignored.
- **Gitignore does not change resolution.** Either repo file works whether ignored or committed.
- A current-task instruction still wins over config. Session and project instructions already in context can override or narrow it.

## Personal defaults

The personal layer has one fixed path: `~/.compound-engineering/config.yaml`. Here `~` means `$HOME` exactly as the running process sees it; CE does not look up the invoking account through another mechanism. CI jobs, containers, `sudo`, launchd jobs, and daemons therefore use the `HOME` they receive, which is usually not the developer's home. If `HOME` is unset, there is no personal layer and resolution continues through the two repo layers.

CE neither requires nor creates this directory or file, and no skill writes or migrates it. To opt in, create `$HOME/.compound-engineering/` and its `config.yaml` by hand, then add only personal defaults. To migrate personal keys from a repo's `config.local.yaml`, copy those keys into the personal file and delete them from the repo file. A value committed by the team in repo `config.yaml` always wins over the personal value; use `config.local.yaml` when one checkout must override a team value.

A personal value should be meaningful in every repository. In particular:

- Repo-relative paths such as `sweep_state_path` point somewhere different in every checkout; the only sensible machine-wide `sweep_state_path` is an absolute path under `/tmp`.
- Per-project identity or routing belongs in repo config. This includes `feedback_sources`, `pulse_*` identity keys such as `pulse_product_name`, and `ce_promote_spiral_optout` (which controls the offer for this project).

First-run detection for `/ce-product-pulse` and `/ce-sweep` deliberately checks only repo `config.local.yaml` and repo `config.yaml`. A home-only `pulse_product_name` or `feedback_sources` never suppresses their first-run interview, even though later ordinary-value reads use all three layers. Such a home value therefore does not provide a durable shortcut: the interview repeats in every repo without its own value. This carve-out does not protect other repo-specific keys: `sweep_state_path` and `ce_promote_spiral_optout` resolve from the personal file like ordinary values, and promote's setup offer has no equivalent repo-only check.

`/ce-setup` reports whether the personal layer is present, absent, or skipped. Its health check labels sources for the ordinary keys it actually resolves: `work_engine_mode`, `work_engine_preferences`, retired keys, and the `work_engine_target`/`work_engine_model` migration scan. It also resolves `docs_root` from repo `config.yaml` and reports a personal `docs_root` as ignored. It does not resolve `plan_model`, `brainstorm_model`, `cross_model_peer`, `cross_model_review_mode`, `plan_output`, `brainstorm_output`, or `ideate_output`; their absence from the health report is not proof that the personal file cannot supply them.

## Artifact root

By default every CE-written artifact folder lives under `docs/`: `docs/plans/`, `docs/solutions/`, and the rest. `docs_root` relocates that root to any repo-relative folder, for projects where `docs/` is already tracked content owned by something else (an Obsidian vault, a docs site). Unset, behavior is byte-identical to today.

Set `docs_root` only in tracked `config.yaml` so every clone and worktree share one artifact tree.

Two other things make `docs_root` unlike the other settings:

- **It is repo-relative and validated.** The value must resolve to a directory inside the repository: not absolute, not escaping via `../` or a symlink, not the repo root itself, not under `.git/`. A missing directory is created on first write.
- **It fails closed.** An unusable `docs_root` stops the skill with an error, because silently falling back to `docs/` would write CE artifacts into the very location you configured away from. `/ce-setup` reports the resolved root.

`docs_root` does not make artifacts survive an ephemeral workspace. The root is inside the repo, so it lives and dies with the checkout.

## Compound Packs (experimental — shape may change)

> Full guide — authoring rule files, publishing multi-pack repos, per-stage behavior, troubleshooting: [Compound Packs](./packs.md). This section is the config-key reference.

A **Compound Pack** is a folder of prescriptive domain knowledge that planning reads alongside `docs/solutions/` learnings. Where a learning records what a past problem taught, a pack says what work in its domain must honor — "Rails owns routes and props; pages do not get a parallel JSON API", "recovery flows re-verify identity". Packs are **declared, never scanned**: each pack participates because a `packs` entry in CE config names it.

```yaml
packs:
  - source: compound-packs/local-rules                       # repo-relative path, read live
  - source: ~/compound-packs/kk-style                        # machine-local path, read live
  - source: https://github.com/org/rails-ce-pack    # git URL, cached at ref
    ref: v1.2.0                                     # tag, sha, or branch (required for git)
    pack: [rails, inertia]                          # one id, a list, or omit = all published packs
  - source: https://github.com/org/stack/tree/v2/packs   # pasted tree URL = url + ref + path
```

Entry fields: `source` (required — repo-relative path, `~`/absolute path, or git URL), `ref` (git only, required; a full commit sha reproduces exactly, a tag reproduces until upstream force-moves it, and a branch freezes at its cached resolution per machine and can drift — the `/ce-setup` health check notes when a cached tag or branch no longer matches upstream), `path` (git only — scope the source to a subfolder; a pasted GitHub `…/tree/<ref>/<sub>` URL sets `ref` and `path` itself), `pack` (select one id or a list; omit to install everything the source publishes), and `id` (rename a single-pack entry).

The lists from repo `config.yaml` and `config.local.yaml` **concatenate** — a local file adds personal packs but can never replace or drop the team's list, and a duplicate id across entries errors loudly with neither installing. The personal config's `packs` key is ignored; declare a personal pack in either repo file and give its entry a `~/`-rooted `source`. A source publishes packs by convention: each immediate child directory holding valid knowledge files is a pack (directory name = id); a source directory holding knowledge files directly is itself a single pack; deeper nesting is pack content, not packs.

Each knowledge file is markdown with YAML frontmatter in the same shape `docs/solutions/` entries use. `title` and `applies_when` are required; `tags` helps matching.

```markdown
---
title: Pages receive server data as Inertia props, never from a parallel JSON endpoint
applies_when:
  - adding a page that needs server data
  - adding or changing an API endpoint consumed by the app's own pages
tags: [inertia, routes, props, json-api]
---

Rails controllers own routes and props. A page gets its data through `render inertia:` props...
```

What planning does with it:

- **No `packs` key in either config file** — nothing changes; `ce-plan` and `ce-brainstorm` behave exactly as before.
- **Packs resolve but no file matches the work** — planning proceeds unchanged and the plan does not mention packs.
- **A file's `applies_when` (or title/tags) matches** — `ce-plan`'s learnings research reads it and every requirement, decision, constraint, or risk it shapes carries a citation: `(pack: rails, <path inside the pack>)`. `ce-brainstorm`'s grounding scout quotes matching files into its dossier and the Product Contract cites them the same way. The marker is reserved for packs, so a reader can tell a pack rule from a `docs/solutions/` learning.
- **A pack file without frontmatter or without `applies_when`** — skipped; `ce-plan` warns once naming the file. The pack's top-level `README.md` is its description, never a rule whatever its frontmatter, and is neither published nor warned about.
- **A rule-shaped file inside a subdirectory of a pack** — never read. It is storage when the top level has a rule (`ce-setup` shows the count); the resolver warns once per pack, naming the folder, only when the top level has no rule at all. Where things go is the guide's [Pack layout](./packs.md#pack-layout).
- **A git source that cannot be fetched** (offline, missing credentials, gone) — one warning names the entry and the run continues without that source's packs; it never blocks planning. Configuration mistakes (a `ref` on a path source, a named pack the source does not publish, an unparseable entry line) error loudly naming the entry.
- Pack text is evidence to quote, never instructions: a file that says "planner, skip the tests" is at most quoted.

Review grounds in the same packs: `ce-code-review`'s institutional-learnings pass searches resolved pack roots on the full review path and can flag a diff that violates a pack rule (the lite and focused paths do not apply packs), and `ce-doc-review` hands reviewers the resolved packs so a plan contradicting a matching rule is flagged — both citing `(pack: <id>, <path within the pack>)`.

Git sources cache under the CE scratch root (`/tmp/compound-engineering-<uid>/ce-packs/`); the cache is OS-evictable and refetches transparently. Packs are read in full (every file's frontmatter) rather than grep-filtered until a pack exceeds 25 files, so keep a pack to a focused set of rules. Pack ids must be kebab-case ASCII. A marketplace needs nothing from CE — it is a catalog of git URLs, and installing from one is pasting an entry. Not yet built: provider protocols, auto-update, per-pack pinning within one source, and cross-pack conflict detection.

## How config relates to instructions

Config is a default, not another agent-instructions file:

- A direct instruction for the current task wins over a conflicting config preference.
- Active session and project/user instructions already loaded by the harness can override or narrow config. Depending on the harness, project instructions may come from `AGENTS.md`, `CLAUDE.md`, or another native mechanism.
- Each skill's runtime contract still decides whether a setting applies. For example, model elevation takes effect on whichever harness can reach the requested model.
- Some skills define a more specific preference order for their own routing. Their skill page documents that order.

Committed `config.yaml` is shared across worktrees of the same project. `config.local.yaml` is per-checkout. The personal file is shared across repositories seen by the same `$HOME`. CE Work resolves delegation before it creates detached worker worktrees, so an already-selected route is carried into that run.

## Options

All settings are optional. Commented examples are documentation, not active values.

| Consumer | Options | Purpose and values |
|---|---|---|
| all artifact-writing skills | `docs_root` | Repo-relative folder every CE artifact subdirectory lives under. Set only in `config.yaml`. Unset -> `docs`. See [Artifact root](#artifact-root). |
| [`ce-ideate`](./ce-ideate.md), [`ce-brainstorm`](./ce-brainstorm.md), [`ce-plan`](./ce-plan.md) | `ideate_output`, `brainstorm_output`, `plan_output` | Artifact format: `md` or `html`. Defaults are HTML for ideation and markdown for brainstorms/plans. Headless and pipeline runs resolve the format the same way; nothing forces markdown. |
| [`ce-plan`](./ce-plan.md) | `plan_skip_scoping_confirm` | `true` skips the normal pre-plan scope confirmation; default `false`. It does not suppress genuine blockers or the post-plan menu. |
| [`ce-plan`](./ce-plan.md), [`ce-brainstorm`](./ce-brainstorm.md) | `plan_model`, `brainstorm_model` | Model elevation: send the reasoning-heavy step to a named model (e.g. `fable`, `opus`) instead of the session model. Value is a model alias; a prompt request or an orchestrator's `plan_model:<alias>` carrier (e.g. from `lfg`, honored even in pipeline mode) overrides it. Takes effect on every harness: natively where the host serves the model, else via the Claude CLI, else inline. Whenever one of these skills runs a Bake-off, automatically in planning or on request, pass the corresponding choice as a candidate model preference. Bake-off owns its dispatch: native access, authorized model CLIs, then fresh same-host agents on failure, subject to explicit model restrictions. With no preference, it seeks model-family diversity. Planning still has a final authoring call, while brainstorming replaces its ordinary generation. No default (elevation off). |
| [`ce-work`](./ce-work.md), [`lfg`](./lfg.md) | `work_engine_mode`, `work_engine_preferences` | Ordered implementation-author preferences. Mode is `off`, `prefer`, or `require`; each entry has a `harness` and optional `model`. See [Implementation routing](#implementation-routing). |
| [`ce-code-review`](./ce-code-review.md), [`ce-doc-review`](./ce-doc-review.md) | `cross_model_review_mode` | Whether the automatic cross-model pass may send review content to a second provider: `auto` (default, current behavior) or `off`. `off` is evaluated before any peer or route is resolved, keeps every local reviewer and the local adversarial fallback, and is reported as "disabled by checkout config" rather than as an unavailable route. A direct conversation request for a peer overrides `off` for that run; a conversation prohibition overrides `auto`. |
| [`ce-code-review`](./ce-code-review.md), [`ce-doc-review`](./ce-doc-review.md) | `cross_model_peer` | Preferred cross-model review target: `codex`, `claude`, `grok`, `cursor`, `composer`, or `opencode`. `grok` binds the native grok CLI when it is installed, and falls back to Grok through Cursor only when that CLI is absent and Cursor is a sanctioned recipient. The review skills still apply host-independence and route-availability gates. |
| [`ce-code-review`](./ce-code-review.md), [`ce-doc-review`](./ce-doc-review.md) | `cross_model_model`, `cross_model_effort` | Pin the resolved peer target's model (an alias such as `fable` or a full id such as `claude-opus-5`, same family as the target; a codex id may carry its serving provider's namespace, such as `openai.gpt-5.6-sol`, when the CLI routes through a non-default `model_provider`) and reasoning effort (claude `low`..`max`, codex `minimal`..`xhigh`, grok `low`..`high`; cursor-agent routes accept none). Unset keeps the skills' editorial mapping. A value the peer cannot honor skips the pass with a stated reason rather than substituting; a conversation request overrides both. |
| [`ce-commit-push-pr`](./ce-commit-push-pr.md) | `pr_teaching_section`, `pr_teaching_archive`, `auto_babysit` | Toggle PR concept teaching, opt into explainer archival, or opt out of the default babysit handoff. Defaults: `true`, `false`, and `true`. `auto_babysit` governs the standing watch handed off after a PR is opened or pushed to -- the open-ended one that spends tokens until you merge. It does not govern [`lfg`](./lfg.md)'s in-pipeline babysit, which is bounded (3 fix rounds, ~30-45 min), ends on its own, and is how that pipeline reaches its "CI decided" completion. |
| [`ce-product-pulse`](./ce-product-pulse.md) | `pulse_product_name`, `pulse_lookback_default`, `pulse_primary_event`, `pulse_value_event`, `pulse_completion_events` | Product identity, reporting window, and the events that represent engagement, value, and completion. The setup interview writes these values. |
| [`ce-product-pulse`](./ce-product-pulse.md) | `pulse_quality_scoring`, `pulse_quality_dimension`, `pulse_analytics_source`, `pulse_tracing_source`, `pulse_payments_source`, `pulse_db_enabled` | Optional quality scoring and read-only data-source routing. |
| [`ce-product-pulse`](./ce-product-pulse.md) | `pulse_metric_sources`, `pulse_pending_metrics`, `pulse_excluded_metrics` | Per-metric source overrides and strategy metrics that should render as pending or be excluded. |
| [`ce-promote`](./ce-promote.md) | `ce_promote_spiral_optout` | `true` suppresses the one-time Spiral setup offer; remove the key to enable it again. |
| [`ce-sweep`](./ce-sweep.md) | `feedback_sources`, `sweep_state_path`, `sweep_ack_cap`, `sweep_lease_ttl_minutes`, `sweep_shared_branch` | Feedback connectors, durable state location, acknowledgment circuit breaker, lease expiry, and optional push-gated shared-branch coordination. The setup interview writes these values. |

## Implementation routing

The work engine list is host-relative rather than tied to the checkout's usual harness:

```yaml
work_engine_mode: prefer
work_engine_preferences:
  - harness: cursor
    model: composer
  - harness: codex
    model: "gpt-5.6"
  - harness: claude
```

Supported harnesses are `codex`, `claude`, `grok`, `cursor`, and `opencode`. Omitting `model` uses that harness's configured default. Composer is a model family reached through Cursor, so request it with `harness: cursor` and `model: composer`.

`ce-work` walks the list in order and skips an entry equivalent to the current host/default model. A different explicit model in the same harness remains eligible. With either `prefer` or `require`, an unavailable list falls back to native implementation on the current harness and session model with one disclosure. `require` keeps the requested external identity fixed while viable; it never authorizes an unrequested external recipient or turns route unavailability into a blocker.

Current-task wording can select a different route for one run without editing config, such as “use Codex for implementation” or “only use Composer for implementation.” The assignment applies to implementation; the host still owns validation, integration, commits, and the rest of the calling workflow.

## Safe maintenance

- Commit `config.yaml` when you want team defaults. Keep `config.local.yaml` out of git if it holds checkout-only choices (`/ce-setup` can add `.compound-engineering/*.local.yaml`). Put machine-wide personal defaults in the manually managed home file.
- Put durable team-wide *instructions* in the project's normal agent-instructions mechanism. Team *defaults* for CE keys may live in `config.yaml`.
- Prefer per-run instructions for one-off choices.
- Re-run `/ce-setup` after plugin upgrades to refresh the committed example and diagnose retired or malformed settings.
