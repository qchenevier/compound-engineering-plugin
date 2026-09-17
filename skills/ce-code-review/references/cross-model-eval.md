# Cross-Model Adversarial Pass — Skill-Creator Eval Spec

This is the required behavioral eval for ce-code-review's cross-model pass.
Cases 1-9 cover scope `default` (the adversarial lens only). Cases 10-16 cover
scope `all` (`references/all-reviewers-external.md`). Deterministic route tests cover the worker; these cases cover
the SKILL.md/reference orchestration that only a fresh agent can execute. Inject
the current `SKILL.md`, `references/cross-model-review.md`,
`references/all-reviewers-external.md` for the `all` cases, and the relevant
Stage 5 synthesis prose through the `skill-creator` workflow. Run on Claude Code
and Codex with fake peer CLIs first on PATH.

## Eval cases

1. **Activation runs only on the existing gate.** A local-aligned or standalone
   diff that selects `adversarial-reviewer` launches one detached cross-model
   adversarial job in the Stage 4 wave. A trivial diff that does not select the
   persona launches none. A `pr-remote` or `branch-remote` review launches none
   even when adversarial analysis is warranted.

2. **Host identity and fixed route precede egress.** The orchestrator keeps host
   harness and serving family separate, excludes an attestably same-family
   target, resolves exactly one target and concrete route, verifies every
   recipient against the allowlist, discloses the reviewed-code egress, and only
   then dispatches with `CROSS_MODEL_HOST_HARNESS` and
   `CROSS_MODEL_FIXED_ROUTE`. An unattested host serving family skips automatic
   dispatch.

3. **Cursor and Composer remain distinct.** A stated `cursor` preference selects
   Cursor default/Auto with no `--model`; `composer` selects an explicit
   Composer-family model through Cursor. A receiptless Cursor or Composer return
   records `model_actual: unverified` and `independence_verified: false`.

4. **Fold-in promotion requires verified independence.** A stubbed
   `adversarial-<provider>.json` finding matching the in-process adversarial
   finding promotes one anchor step only with `independence_verified: true`.
   With `independence_verified: false`, it remains attributed evidence and does
   not count as different-model corroboration. Peer findings never gain silent
   apply authority.

5. **Failures are additive and non-blocking.** A missing CLI means no job starts;
   a human-facing markdown review reports the pass as not run. A started timeout, failure,
   or unusable return is named in Coverage and the in-process review completes.
   The worker never changes recipients internally; any recipient-changing retry
   requires a new disclosure and sanction.

6. **Preferred-first bounded adaptation.** The declared mapping is attempted
   first. Only an observed unavailable, obsolete, or incompatible model permits
   a same-target/same-family override bound by
   `CROSS_MODEL_MODEL_OVERRIDE_TARGET` and `CROSS_MODEL_MODEL_OVERRIDE`.
   Cross-family substitution, override leakage, silent explicit-model changes,
   and new recipients are rejected.

7. **Detached lifecycle remains bounded.** The orchestrator starts the peer job
   in a short runner call, polls in bounded slices while other review work
   continues, reaps at the aggregate deadline, reads owned results and skip logs,
   names non-`done` terminal states, and removes private scratch.

8. **Mode-specific disclosure is honest.** Human-facing default mode announces
   the fixed route and egress before dispatch and calls it independent only when
   serving families differ attestably. Receiptless routes say "requested
   <model>; serving model unverified on this route." `mode:agent` emits no
   user-facing prose but retains the worker's stderr audit record.

9. **Oversized diffs recover without one giant prompt.** A fixture above the
   inline token or file-count limit sends the peer the orchestrator's compact
   semantic review map plus a private exact-diff path, never the whole diff.
   The worker does not cut semantic shards or invent risk divisions; the
   orchestrator does, and the adversarial agent reads bounded ranges and narrows
   them further rather than returning a progress note or silently omitting the
   pass. A normal-sized fixture keeps the direct diff path.

## Scope `all` cases

The repo-owned cells for these cases are the `ce-code-review/all-scope-*` rows in
`tests/skill-eval-cell/catalog.ts`. They are read-only decision probes over
stub artifacts and job directories, so no provider is called.

10. **Scope resolution order.** `cross_model_review_mode: off` is read first:
    with no conversation opt-in no job starts and the reason is "disabled by
    checkout config", even when the scope key is `all`. An explicit conversation
    opt-in for external review of all reviewers runs `all`. A conversation
    prohibition starts no job whatever the key says. A conversation scope request
    overrides the key in both directions for that run.

11. **Eligibility.** At `all`, every selected persona the worker accepts goes
    external. `testing-reviewer`, `learnings-researcher`,
    `agent-native-reviewer`, `deployment-verification-agent`, and
    `previous-comments-reviewer` stay on the host, and so does
    `adversarial-reviewer`. `pr-remote` and `branch-remote` start no job, and the
    lite and focused depth paths run at `default`.

12. **Same-family or missing route.** When the resolved target is the host's
    own family, or no eligible route is installed, the run uses `default` and
    says why in one line.

13. **One disclosure, then every start.** One disclosure before any job names
    the recipient, the model and effort, the number and names of the reviewers
    sent, and that code leaves the machine. Every job starts at Stage 3d before
    the local wave, with one shared deadline.

14. **Per-persona fallback.** A job that failed, was skipped, timed out, or was
    reaped runs as its in-process twin, and the report names the persona and the
    reason. No replacement recipient is started and no route is retried by hand.
    An artifact with no findings is a completed review.

15. **Quota or authentication stops the external phase.** The first such
    failure reaps the jobs still running, keeps collected results, dispatches
    twins for every persona without a result, and restarts nothing. Jobs still
    running at the shared deadline are reaped, recorded as `timeout`, and run as
    twins.

16. **Provenance.** Each selected reviewer is external-verified (the artifact
    records `independence_verified: true`), external-unverified,
    host-fallback with a reason, or host-by-design. The state comes from the
    artifact and the `peers` record, never from the reviewer's name.

## Pass criteria

All sixteen cases pass on the current on-disk source on Claude Code and Codex. The
negative activation cases launch no peer, the fixed-route cases perform no
worker-internal recipient fallback, and only `independence_verified: true`
artifacts can promote agreement.
