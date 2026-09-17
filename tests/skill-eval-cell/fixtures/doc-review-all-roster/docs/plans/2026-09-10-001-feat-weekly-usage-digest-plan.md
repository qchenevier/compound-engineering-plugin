---
title: Weekly usage digest email - Plan
type: feat
date: 2026-09-10
---

# Weekly Usage Digest Email - Plan

## Product Contract

### Summary

Send each workspace owner a weekly email summarizing seat usage, the three most active projects, and seats idle for 30 days, so owners can right-size their plan before renewal.

### Requirements

- R1. The digest goes to workspace owners only, every Monday at 09:00 in the owner's timezone.
- R2. It lists seat usage, the three most active projects, and seats idle for 30 days or more.
- R3. Owners can unsubscribe from the digest without leaving other notifications.
- R4. We expect the digest to cut involuntary churn at renewal by 15% within two quarters.

### Scope Boundaries

- No in-app version of the digest in this release.

## Implementation Units

### U1. Digest query

- **Goal:** compute the three sections per workspace from the usage tables.
- **Files:** `src/digest/query.ts`
- **Approach:** one query per section over `usage_events`, grouped by workspace.

### U2. Scheduled send

- **Goal:** send the digest at 09:00 owner-local time on Mondays.
- **Files:** `src/digest/schedule.ts`, `src/digest/template.ts`
- **Approach:** an hourly job selects owners whose local time is Monday 09:00 and sends through the existing mailer.

### U3. Unsubscribe

- **Goal:** a one-click unsubscribe that only affects the digest.
- **Files:** `src/digest/unsubscribe.ts`
- **Approach:** a signed link that sets `digest_opt_out` on the owner's preferences.
