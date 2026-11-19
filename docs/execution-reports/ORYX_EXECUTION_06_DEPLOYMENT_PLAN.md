# ORYX — Execution 06: safe merge and deployment plan

Scope: the employee electronic file and the unified attachment/preview work.
This branch carries **two additive migrations**, so unlike a pure presentation
change it has a real, ordered database step. Nothing in it drops a table, drops
a column or rewrites an existing row.

## What changed

| Area | Change | Risk |
| --- | --- | --- |
| `packages/database` migration 1 | `Employee` +4 nullable/defaulted columns; `EntityAttachment` +3 defaulted columns; new `EmployeePenalty` and `EmployeeBonus` tables | Low — additive DDL only |
| `packages/database` migration 2 | `EntityAttachment.companyId` becomes nullable (platform CMS rows have no tenant); adds `(entityType, entityId)` index; FK recreated | Low — widens a constraint, no row touched |
| `packages/shared` contract | `EmployeePayslipDto.workedMinutes: number \| null` (additive) | None — additive field |
| `apps/api` payroll run | `workedMinutes` frozen into `Payslip.snapshot` at run creation | None — snapshot JSON, no column |
| `apps/api` employee file | Reads `workedMinutes` from the snapshot, `null` when absent | None — old payslips read `null` |
| `apps/api` report pack | Window end closes at `23:59:59.999Z` instead of midnight | Low — widens the window by one day's tail |
| `apps/admin` employee file | Worked-hours column in payroll table, preview, print and Excel | None — presentation |
| `apps/admin` reports export | Adds penalties and bonuses sheets (3 → 5 sheets) | None — new sheets only |

## What is not in this branch

The wider request asked for two things this branch does not deliver. Stating
them here so no one reads the rest of the plan as covering them:

- **A real PDF exporter.** Reports print through `printDocument`, which opens a
  browser print document; the operator picks "Save as PDF" in the print dialog.
  There is no generated `.pdf` file server-side or client-side, and no PDF
  library is a dependency. Excel export is a real `.xlsx` file.
- **Print and download are not permission-gated in the UI.** The API gates the
  data and the attachment bytes, so a caller without the read right cannot
  obtain them; but the print and download buttons are not individually hidden by
  a print/download permission, because no such permission exists in the
  catalogue.

## Pre-deployment checks

1. **Build order.** `@oryx/shared` and `@oryx/database` compile before the apps,
   because `apps/api` and `apps/admin` resolve them from `dist/`.

   ```bash
   pnpm --filter @oryx/shared build
   pnpm --filter @oryx/database build
   pnpm --filter @oryx/api build
   pnpm --filter @oryx/admin build
   ```

2. **Two migrations must be applied, in order, before the API starts.**

   ```bash
   pnpm db:generate
   pnpm db:migrate          # applies 20261119025019_… then 20261119033000_…
   ```

   `pnpm db:migrate` must report both as applied. If it reports a drift or wants
   to reset, **stop** — do not reset a populated database. Take a backup first
   (see below). The first migration adds nullable or defaulted columns and two
   new tables, so it succeeds on a populated table without a rewrite. The second
   relaxes a `NOT NULL` and recreates one FK; it does not touch rows.

3. **Take a database backup before migrating.** These are additive, but a backup
   is what makes the rollback path in this document true rather than hopeful.

   ```bash
   pg_dump "$DATABASE_URL" -Fc -f oryx-pre-e06-$(date +%Y%m%d%H%M).dump
   ```

4. **Test gates before promoting.**

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

## Merge sequence

The branch is 11 commits ahead of `main` with no merge conflicts expected, but
merge it as a merge commit rather than a squash: the migrations are dated and
ordered, and a squash hides which commit introduced which DDL.

1. **Open the PR against `main`** and require the four test suites plus the two
   typechecks to be green before merge.
2. **Merge with `--no-ff`.** Do not rebase the migrations; their folder names
   carry the order Prisma applies them in.
3. **Never merge a second branch that also adds a migration folder without
   re-running `pnpm db:migrate` on a copy of production data.** Two branches can
   each generate a migration that assumes the other's schema.

## Rollback

Revert the **admin** and **API** deploys to the previous build first. Old code
ignores the new columns and the new JSON key, so that step alone is safe.

The database is the part that needs care:

- **Code rollback only (the common case):** leave the schema in place. Old code
  never reads `EmployeePenalty`, `EmployeeBonus` or the new columns, and the
  nullable `EntityAttachment.companyId` still accepts every row the old code
  writes. No data rollback is needed.
- **Schema rollback (only if the migrations themselves must be undone):** restore
  the `pg_dump` taken in step 3. Do **not** hand-write a down-migration that
  drops `EmployeePenalty` or `EmployeeBonus` on a live database — those tables
  hold real records by then, and dropping them loses data the old code never
  wrote. Prisma has no automatic down-migration, so the dump is the rollback.

Payslips created by the new build keep their `workedMinutes`; payslips created
by the old build read `null`, which the UI renders as `—` rather than a
misleading zero.

## Notes for the operator

- Historical payslips stay `null` for worked hours. That is deliberate: the data
  was never captured, and back-filling it from today's attendance records would
  invent history.
- The report window fix widens every report's end boundary to the end of the
  chosen day. Any figure that changes for a past period is a record that was
  previously being dropped, not a new one being counted twice.
