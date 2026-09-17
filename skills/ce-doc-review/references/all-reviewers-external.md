# All Reviewers on the Cross-Model Target

Read this file only when `references/cross-model-review.md` resolved the review scope to `all`. At that scope, every selected reviewer that can run without tools is served by the one resolved cross-model target, and the host runs the rest. The report says, for every selected reviewer, which model produced its findings.

Everything in `references/cross-model-review.md` still applies: host attestation, the fixed route and its sanction, model and effort overrides, the command-sandbox boundary, the scratch root and run directory, the runner call, the bounded wait loop, the verified fold-in read, skip classification, and cleanup. This file states only what changes at scope `all`.

**Done when:** every selected reviewer has exactly one result, from its external job or from its in-process twin, or is named as failed in Coverage, and every external job has its own Coverage row.

## Which reviewers go external

- Send every selected reviewer whose short name the worker accepts at scope `all`: `coherence`, `design-lens`, `scope-guardian`, `security-lens`, and `product-lens`. The worker's allowlist decides eligibility. It refuses every other name, so never send one.
- `feasibility-reviewer` stays on the host, because it needs repository reads and the external reviewers run without tools.
- `adversarial-document-reviewer` stays on the host, because its job is to challenge the other reviewers, and at this scope they run on another model.
- The whole-document sweep does not run. It existed to give a different model a read of the lenses that stayed on the host, and at this scope those lenses already run externally.

Host-by-design reviewers are dispatched in the host wave as `references/dispatch.md` describes. An external reviewer's in-process twin is dispatched only as its fallback.

## Disclosure

Give one disclosure before any job starts, in place of the Step 3 announcement. It names the recipient, including the route and intermediary on cursor-agent routes. It names the requested model and effort, with Step 3's unverified marker on routes that return no served-model record. It gives the number of reviewers sent and their names. It says that each reviewer's document content is sent to that provider. Invoking the skill remains the authorization, and one disclosure covers every job. In non-interactive mode, print no prose; the worker's stderr audit line per send is the disclosure.

## Starting the jobs

Start one job per external reviewer, using Step 4's start call with these changes:

- Give each job the same document slice its in-process twin would get, written to a file under `$RUN_DIR`.
- Add `CROSS_MODEL_REVIEW_SCOPE="all"` to the `env` prefix of every start. Without it, the worker treats the job as a `default` peer and downgrades every `safe_auto` finding.
- On round 2 or later, render this round's decision primer as `references/decision-primer.md` describes, write it once to a regular file directly under `$RUN_DIR`, and add `CROSS_MODEL_DECISION_PRIMER="<absolute path of that file>"` to every start's `env` prefix. The external reviewers then honor earlier rejections as their twins do. On round 1, omit the variable. A primer file the worker rejects is a skip for that reviewer and follows the fallback rule below.

Start every job in one short sequence of calls, before the host wave, with no concurrency cap. Print `peer-deadline-secs` once, capture the epoch time right after the final start, and use that one deadline for every job. Then dispatch the host-by-design reviewers.

## Collecting the jobs

After the host wave returns, run Step 4's bounded wait loop once over every job id together; `wait` accepts several ids. When a job turns terminal without `done`, read its `out.log` right away and classify it under Step 5, so a quota or authentication failure is seen while other jobs still run. At the deadline, reap every job still running and record it as `timeout`. Then read each artifact through Step 5's verified read.

## Fallback to the in-process twin

An external reviewer falls back when it has no usable artifact: the job was skipped, failed, timed out, died without a result, was reaped, or its read failed. At this scope a skip is never silent. Dispatch its in-process twin as `references/dispatch.md` describes, with the same slice and the current round's primer, and record the reason: the terminal state, the skip evidence, or the unreadable result. An artifact with no findings is a completed review, not a fallback.

When any job shows quota, usage-limit, rate-limit, or authentication failure, stop the external phase. Reap every job still running, keep every result already collected, and dispatch twins for every external reviewer without a result. Record each reaped reviewer's reason as stopped after that failure. Report the failure itself under Step 5's rules, including its limits on calling an authentication signal a logout. Restart no job and send nothing to another recipient.

## Provenance and Coverage

Tell synthesis that the scope is `all`, so its scope rules apply. Give every selected reviewer one of four states:

- **external, verified**: its artifact records `independence_verified: true`. Name the served model when the artifact records one.
- **external, unverified**: its artifact exists but does not record `independence_verified: true`. Name the requested model with the unverified marker.
- **host by design**: `feasibility-reviewer`, `adversarial-document-reviewer`, and any selected reviewer the worker does not accept.
- **host fallback**: the in-process twin ran in place of a failed external job. Give the reason.

Render one Coverage row per external job, including jobs that fell back, as `references/review-output-template.md` describes.
