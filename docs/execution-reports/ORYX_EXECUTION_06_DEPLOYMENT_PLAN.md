# ORYX — Execution 06: safe deployment plan

Scope of this branch: the employee electronic file completion. Two behaviour
changes and one additive field. No schema migration, no destructive operation.

## What changed

| Area | Change | Risk |
| --- | --- | --- |
| `packages/shared` contract | `EmployeePayslipDto.workedMinutes: number \| null` (additive) | None — additive field |
| `apps/api` payroll run | `workedMinutes` frozen into `Payslip.snapshot` at run creation | None — snapshot JSON, no column |
| `apps/api` employee file | Reads `workedMinutes` from the snapshot, `null` when absent | None — old payslips read `null` |
| `apps/api` report pack | Window end closes at `23:59:59.999Z` instead of midnight | Low — widens the window by one day's tail |
| `apps/admin` employee file | Worked-hours column in payroll table, preview, print and Excel | None — presentation |
| `apps/admin` reports export | Adds penalties and bonuses sheets (3 → 5 sheets) | None — new sheets only |

## Pre-deployment checks

1. **Build order.** `@oryx/shared` and `@oryx/database` compile before the apps,
   because `apps/api` and `apps/admin` resolve them from `dist/`.

   ```bash
   pnpm --filter @oryx/shared build
   pnpm --filter @oryx/database build
   pnpm --filter @oryx/api build
   pnpm --filter @oryx/admin build
   ```

2. **No migration to run.** `Payslip.snapshot` is an existing JSON column; the
   new key lives inside it. `pnpm db:migrate` should report "No pending
   migrations" — if it wants to create one, stop and investigate.

3. **Test gates before promoting.**

   ```bash
   pnpm --filter @oryx/shared test       # 93
   pnpm --filter @oryx/api test:e2e      # 247 (needs the seeded DB)
   pnpm --filter @oryx/admin test:ui     # 142 (needs both services running)
   pnpm --filter @oryx/mobile test       # 17
   ```

   Run the API with `AUTH_THROTTLE_LIMIT=100000 THROTTLE_LIMIT=1000000
   REFRESH_THROTTLE_LIMIT=100000` or the browser suite will hit 429s.

## Deployment sequence

1. Deploy the **API** first. The new field is additive, so a still-running old
   admin bundle simply ignores it.
2. Restart the API process (compiled `dist/main.js`, not a watch server).
3. Deploy the **admin** app, then restart `next start`. A stale Next server keeps
   serving old chunks and the new column will not appear.
4. Verify with three read-only calls and one screen:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://<host>/api/health
   ```

   - `GET /api/v1/hr/employees/:id/file/payroll` returns `workedMinutes` on each
     item (a number, or `null` for historical payslips).
   - `GET /api/v1/hr/employees/:id/file/reports?from=…&to=…` includes a bonus
     created today.
   - The employee file's payroll tab shows the worked-hours column, and the
     reports tab exports a five-sheet workbook.

## Rollback

Revert the admin and API deploys to the previous build. No data rollback is
needed: the only persisted change is a new key inside existing `snapshot` JSON,
and old code ignores unknown keys. Payslips created by the new build keep their
`workedMinutes`; payslips created by the old build read `null`, which the UI
renders as `—` rather than a misleading zero.

## Notes for the operator

- Historical payslips stay `null` for worked hours. That is deliberate: the data
  was never captured, and back-filling it from today's attendance records would
  invent history.
- The report window fix widens every report's end boundary to the end of the
  chosen day. Any figure that changes for a past period is a record that was
  previously being dropped, not a new one being counted twice.
