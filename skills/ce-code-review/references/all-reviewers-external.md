# All Reviewers on the Cross-Model Target

Read this file only when `references/cross-model-review.md` resolved the review scope to `all`, at Stage 3d of the full path. At that scope, every selected reviewer that can run read-only and return the findings schema is served by the one resolved cross-model target, and the host runs the rest. The report says, for every selected reviewer, which model produced its findings.

Everything in `references/cross-model-review.md` still applies: host attestation, the fixed route and its sanction, model and effort overrides, the command-sandbox boundary, the start call, the deadline print, the single bounded status/wait/reap sequence, the verified fold-in read, skip classification, and cleanup. This file states only what changes at scope `all`.

**Done when:** every selected reviewer has exactly one result, from its external job or from its in-process twin, or is named as failed in Coverage; every external job is terminal and its job directory is deleted; and `finish-input.json` has one `peers` entry per external job.

## Which reviewers go external

- Send every selected persona whose short name the worker accepts: `correctness`, `security`, `performance`, `reliability`, `maintainability`, `api-contract`, `data-migration`, `julik-frontend-races`, and `swift-ios`. The worker's allowlist decides eligibility. It refuses every other name, so never send one.
- `learnings-researcher`, `agent-native-reviewer`, and `deployment-verification-agent` stay on the host, because they return prose rather than the findings schema.
- `previous-comments-reviewer` stays on the host, because it needs `gh` and network access.
- `testing-reviewer` stays on the host, because its mutation testing writes to the tree.
- `project-standards-reviewer` stays on the host, because the local project-standards review owns scoped-rule coverage (`references/finish-review.md`).
- `adversarial-reviewer` stays on the host. Its job is to challenge the other reviewers, and at this scope they run on another model. The worker still accepts `adversarial`, but only the default scope sends it.

Stage 3d binds both sets at once: the external set is every eligible selected persona, and the host set is every other selected reviewer plus the twin of any persona whose job did not start. Host reviewers are dispatched in the Stage 4 local wave as `references/dispatch-reviewers.md` describes, at their usual model tier. An external persona's in-process twin is dispatched only as its fallback.

## Disclosure

Give one disclosure before any job starts, in place of the Step 3 announcement. It names the recipient, including the route on cursor-agent routes. It names the requested model and effort, with Step 3's unverified wording on routes that return no served-model receipt. It gives the number of reviewers sent and their names. It says that the reviewed code leaves the machine for that provider. Invoking the skill remains the authorization, and one disclosure covers every job; do not ask for confirmation. In `mode:agent`, print no prose; the worker's stderr audit line per send is the record.

## Inputs for each external persona

Before its start, write two files under `<run-dir>` for each external persona, keeping Step 4's trust split and 32 KiB cap for each file:

- `<persona>-review-constraints.md` is the host-vetted file. It holds only the criteria that apply to that persona, distilled from the project's active instructions and conventions already in your context, or `none`. Never copy raw instruction content or user-controlled text into it.
- `<persona>-review-brief.md` is untrusted review data. It carries the context blocks that persona's in-process twin would receive from `references/subagent-template.md`: the intent summary, the PR context when a PR is in scope, the standards paths from Stage 3b when the persona uses them, and the review base, plus the risk divisions of Step 4 that matter to that persona. Do not paste the diff or the full file list into it.

The worker refuses a non-adversarial persona whose brief is missing or oversized, before anything leaves the machine. That refusal is a skip for that persona and follows the fallback rule below.

## Starting the jobs

Start one job per external persona with Step 4's start call and these changes: pass `--label <persona>` to the runner and `"<persona>"` as the worker's fifth argument after `"<run-dir>"`. The worker then reads that persona's brief and inputs and writes `<run-dir>/<persona>-<provider>.json`.

Start every job in one short sequence of calls, at Stage 3d, before the local wave, with no concurrency cap. Print `peer-deadline-secs` once, in the same shell as the first start, capture the epoch time right after the final start, and use that one deadline for every job. It is derived from `CROSS_MODEL_HARD_SECS` exactly as Step 4 states, so the whole external phase is bounded by one deadline window. Record `--start peer` once, with the first start. Persist every job id, its persona, the target, and the requested model and effort in working state.

A persona whose start returns no job id is not recovered by hand at this scope. Keep its twin in the host set, with the start failure as its reason.

## Collecting the jobs

Do not poll while the local wave runs. After it returns, run Step 4's single bounded status/wait/reap sequence once over every job id together: one status read covering them all, then `wait` slices that list every job id still running, repeated until every job is terminal or the shared deadline is spent. When a status read or a `wait` return shows a job terminal without `done`, read its `out.log` right away and classify it under `references/cross-model-recovery.md`, so a quota or authentication failure is seen while other jobs still run. At the deadline, reap every job still running, run the final `wait --max-secs 10` over them, and record each as `timeout`. Then read each artifact through Step 5's verified read, with `--path <run-dir>/<persona>-<target>.json`.

## Fallback to the in-process twin

An external persona falls back when it has no usable artifact: the job did not start, was skipped, failed, timed out, died without a result, was reaped, or its verified read failed. Dispatch the in-process twin of that persona as `references/dispatch-reviewers.md` describes, collected in this turn, and record the reason: the terminal state, the skip evidence, or the failed read. Dispatch every twin needed after collection in one batch. At this scope a fallback never starts a replacement recipient and never repeats a route by hand; the twin covers the lens. An artifact with no findings is a completed review, not a fallback.

When any job shows a quota, usage-limit, rate-limit, or authentication failure, stop the external phase. Reap every job still running and run the final `wait --max-secs 10` over them, keep every result already collected, and dispatch twins for every external persona without a result. Record each reaped persona's reason as stopped after that failure. Report the failure itself under the recovery rules, including their limits on calling an authentication signal a logout. Restart no job and send nothing to another recipient.

## Recording provenance

Record `--end peer --candidates <count of findings across every collected artifact>` once the last job is classified. In `finish-input.json`, write one `peers` entry per external job, including jobs that fell back, with its persona, target, route, outcome, artifact, Coverage sentence, and receipt. Set `provenance` from the artifact and the outcome:

- `external-verified`: the artifact records `independence_verified: true`.
- `external-unverified`: the artifact exists but does not record `independence_verified: true`.
- `host-fallback`: the in-process twin ran in place of the external job; set `reason` and set `artifact` to `null`. The findings helper folds only entries whose provenance is `external-verified` or `external-unverified`, so it ignores an artifact named on any other entry.

A selected reviewer with no `peers` entry is `host-by-design`: the adversarial persona, every ineligible persona, and every persona the worker refused. Set the legacy `peer` object's fields to `null`, because no adversarial job runs at this scope. A twin's return joins `raw-returns.json` like any local return. The findings helper folds each recorded artifact, so never copy an artifact into `raw-returns.json`. Delete every consumed job directory before the merge leaf starts.
