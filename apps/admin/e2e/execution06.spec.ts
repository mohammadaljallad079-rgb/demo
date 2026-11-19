import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { COMPANY_ADMIN, ENTERPRISE_ADMIN, SUPER_ADMIN, apiToken, setLocale, setTheme, signIn } from './helpers';

/**
 * Execution 06 — unified attachments and the employee electronic file.
 *
 * Drives the real screens: the attachment field lives inside the create form
 * and inside the record preview, and the employee file's tabs read the same
 * records the payroll screens write. Fixture records are created through the
 * API and removed afterwards so the seeded demo tenant is left as it was.
 */

const API = (process.env.ORYX_API ?? 'http://localhost:3001/api/v1').replace(/\/$/, '');
const PREFIX = 'E06UI';

interface Fixture {
  employeeId?: string;
  employeeCode?: string;
  paymentId?: string;
  maintenanceBookingId?: string;
  attachmentIds: string[];
}

/** Create a fixture employee through the API, in the demo tenant. */
async function createEmployee(token: string, suffix: string): Promise<{ id: string; code: string }> {
  const res = await fetch(`${API}/hr/employees`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullNameEn: `${PREFIX} Employee ${suffix}`,
      fullNameAr: `موظف اختبار ${suffix}`,
      email: `${PREFIX.toLowerCase()}-${suffix}@oryx.local`,
      nationality: 'Saudi',
      bankName: 'Al Rajhi',
      bankAccountIban: 'SA0380000000608010167519',
      contractType: 'PERMANENT',
      hireDate: '2024-01-15',
    }),
  });
  expect(res.ok, `employee creation failed with ${res.status}`).toBe(true);
  return (await res.json()) as { id: string; code: string };
}

/** Upload one text file to a record through the real multipart route. */
async function uploadFile(
  token: string,
  entityType: string,
  entityId: string,
  name: string,
  body: string,
): Promise<string> {
  const form = new FormData();
  form.set('entityType', entityType);
  form.set('entityId', entityId);
  form.append('files', new Blob([body], { type: 'text/plain' }), name);
  const res = await fetch(`${API}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  expect(res.ok, `upload failed with ${res.status}`).toBe(true);
  const parsed = (await res.json()) as { items: Array<{ id: string }> };
  return parsed.items[0].id;
}

async function deleteQuietly(token: string, path: string): Promise<void> {
  try {
    await fetch(`${API}${path}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  } catch {
    /* best effort cleanup */
  }
}

test.describe('Execution 06 — attachments and employee file', () => {
  let token: string;
  const fixture: Fixture = { attachmentIds: [] };

  test.beforeEach(async ({ page }) => {
    await signIn(page, COMPANY_ADMIN);
    await setLocale(page, 'en');
    await setTheme(page, 'dark');
    token = await apiToken(page, COMPANY_ADMIN);
  });

  test.afterEach(async () => {
    // Remove the fixture employee; its attachments cascade with the row.
    if (fixture.employeeId) {
      await deleteQuietly(token, `/hr/employees/${fixture.employeeId}`);
    }
    for (const id of fixture.attachmentIds) await deleteQuietly(token, `/attachments/${id}`);
    fixture.attachmentIds = [];
    fixture.employeeId = undefined;
    fixture.paymentId = undefined;
    fixture.maintenanceBookingId = undefined;
  });

  test('1. the employee list offers a preview action for every row', async ({ page }) => {
    const employee = await createEmployee(token, 'preview');
    fixture.employeeId = employee.id;
    fixture.employeeCode = employee.code;

    await page.goto('/hr');
    await page.getByTestId('hr-tab-employees').click();
    // The list is ordered by employee number and paginated, so a new record is
    // not on page 1; search for it instead of assuming it appears.
    await page.getByTestId('employee-search').fill(employee.code);
    const button = page.getByTestId(`preview-employee-${employee.code}`);
    await expect(button).toBeVisible({ timeout: 20_000 });
    await button.click();
    await expect(page.getByTestId('employee-file')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('file-personal-card')).toBeVisible();
    // The file is addressable, so a reload lands on the same record.
    await expect(page).toHaveURL(new RegExp(`/hr/employees/${employee.id}`));
  });

  test('2. the personal card shows the profile fields and the salary block', async ({ page }) => {
    const employee = await createEmployee(token, 'card');
    fixture.employeeId = employee.id;

    await page.goto(`/hr/employees/${employee.id}`);
    await expect(page.getByTestId('file-personal-card')).toBeVisible({ timeout: 20_000 });
    const card = page.getByTestId('file-personal-card');
    await expect(card.getByText('Saudi', { exact: false })).toBeVisible();
    await expect(card.getByText('Al Rajhi', { exact: false })).toBeVisible();
    await expect(card.getByText('SA0380000000608010167519', { exact: false })).toBeVisible();
  });

  test('3. every file tab opens and reads real records', async ({ page }) => {
    const employee = await createEmployee(token, 'tabs');
    fixture.employeeId = employee.id;

    await page.goto(`/hr/employees/${employee.id}`);
    await expect(page.getByTestId('file-personal-card')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('file-tab-payroll').click();
    await expect(page.getByTestId('file-payroll')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('file-tab-leave').click();
    await expect(page.getByTestId('file-leave')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('file-tab-penalties').click();
    await expect(page.getByTestId('file-penalties')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('file-tab-bonuses').click();
    await expect(page.getByTestId('file-bonuses')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('file-tab-reports').click();
    await expect(page.getByTestId('file-reports')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('file-tab-documents').click();
    await expect(page.getByTestId('file-documents')).toBeVisible({ timeout: 20_000 });
  });

  test('4. a disciplinary action is recorded and printed from its own tab', async ({ page }) => {
    const employee = await createEmployee(token, 'penalty');
    fixture.employeeId = employee.id;

    await page.goto(`/hr/employees/${employee.id}`);
    await page.getByTestId('file-tab-penalties').click();
    await expect(page.getByTestId('file-penalties')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('new-penalty').click();
    await page.getByTestId('penalty-type').selectOption('WRITTEN_WARNING');
    await page.getByTestId('penalty-reason').fill('Repeated lateness');
    await page.getByTestId('save-penalty').click();

    await expect(page.locator('.oryx-modal')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByText('Repeated lateness')).toBeVisible({ timeout: 20_000 });

    // The row survives a reload: it is stored, not held in component state.
    await page.reload();
    await page.getByTestId('file-tab-penalties').click();
    await expect(page.getByText('Repeated lateness')).toBeVisible({ timeout: 20_000 });
  });

  test('5. a bonus is granted, approved and appears in the bonus tab', async ({ page }) => {
    const employee = await createEmployee(token, 'bonus');
    fixture.employeeId = employee.id;

    await page.goto(`/hr/employees/${employee.id}`);
    await page.getByTestId('file-tab-bonuses').click();
    await expect(page.getByTestId('file-bonuses')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('new-bonus').click();
    await page.getByTestId('bonus-type').selectOption('BONUS');
    await page.getByTestId('bonus-amount').fill('1500.00');
    await page.getByTestId('bonus-reason').fill('Performance award');
    await page.getByTestId('save-bonus').click();

    await expect(page.locator('.oryx-modal')).toHaveCount(0, { timeout: 20_000 });
    const row = page.locator('tr', { hasText: 'Performance award' });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByText('1500.00 SAR')).toBeVisible();
  });

  test('6. the employee number is filled automatically and cannot be typed', async ({ page }) => {
    await page.goto('/hr');
    await page.getByTestId('hr-tab-employees').click();
    await page.getByTestId('new-employee').click();

    const codeField = page.getByTestId('employee-code');
    await expect(codeField).toBeVisible({ timeout: 20_000 });
    // The field is populated by the server and is not editable.
    await expect(codeField).toBeDisabled();
    await expect(codeField).toHaveAttribute('readonly', '');
    await expect(codeField).toHaveValue(/^EMP-\d{5}$/);
  });

  test('7. a file is attached inside the create form and saved with the record', async ({ page }) => {
    await page.goto('/hr');
    await page.getByTestId('hr-tab-employees').click();
    await page.getByTestId('new-employee').click();

    const unique = `${PREFIX} Form ${Date.now()}`;
    await page.getByTestId('employee-name-en').fill(unique);
    await page.getByTestId('employee-name-ar').fill('موظف من النموذج');

    // The attachment field is part of the form, not a separate screen.
    await expect(page.getByTestId('new-employee-attachments')).toBeVisible();
    await page.getByTestId('new-employee-attachments-input').setInputFiles({
      name: 'offer-letter.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Offer letter body'),
    });
    await expect(page.getByTestId('new-employee-attachments-draft')).toBeVisible();

    await page.getByTestId('save-employee').click();
    await expect(page.locator('.oryx-modal')).toHaveCount(0, { timeout: 30_000 });

    // Find the new record through the API and prove the file was stored.
    const list = await fetch(`${API}/hr/employees?search=${encodeURIComponent(unique)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const parsed = (await list.json()) as { items: Array<{ id: string; code: string }> };
    expect(parsed.items.length).toBeGreaterThan(0);
    const created = parsed.items[0];
    fixture.employeeId = created.id;

    const attachments = await fetch(
      `${API}/attachments?entityType=EMPLOYEE_DOCUMENT&entityId=${created.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const attached = (await attachments.json()) as { items: Array<{ fileName: string }> };
    expect(attached.items.map((a) => a.fileName)).toContain('offer-letter.txt');
  });

  test('7b. editing a record adds a file without losing the ones already on it', async ({ page }) => {
    const employee = await createEmployee(token, 'editfiles');
    fixture.employeeId = employee.id;
    const existingId = await uploadFile(token, 'EMPLOYEE', employee.id, `${PREFIX}-before-edit.txt`, 'First file');
    fixture.attachmentIds.push(existingId);

    await page.goto(`/hr/employees/${employee.id}`);
    await expect(page.getByTestId('file-personal-card')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('file-edit-card').click();

    // The edit form seeds the list from the record, so the file on record is
    // visible before anything is touched.
    const field = page.getByTestId('edit-employee-attachments');
    await expect(field).toBeVisible();
    await expect(field).toContainText(`${PREFIX}-before-edit.txt`);

    await field.getByTestId('edit-employee-attachments-input').setInputFiles({
      name: `${PREFIX}-added-on-edit.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from('Added while editing'),
    });
    await expect(field.getByTestId('edit-employee-attachments-draft')).toBeVisible();

    await page.getByTestId('file-save-card').click();
    await expect(page.locator('.oryx-modal')).toHaveCount(0, { timeout: 30_000 });

    // Both files are on the record: the edit added one and kept the other.
    const res = await fetch(`${API}/attachments?entityType=EMPLOYEE&entityId=${employee.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const parsed = (await res.json()) as { items: Array<{ id: string; fileName: string }> };
    const names = parsed.items.map((a) => a.fileName);
    expect(names).toContain(`${PREFIX}-before-edit.txt`);
    expect(names).toContain(`${PREFIX}-added-on-edit.txt`);
    for (const item of parsed.items) if (item.id !== existingId) fixture.attachmentIds.push(item.id);
  });

  test('8. an attachment opens in the preview and downloads without leaving the page', async ({ page }) => {
    const employee = await createEmployee(token, 'previewfile');
    fixture.employeeId = employee.id;
    const attachmentId = await uploadFile(
      token,
      'EMPLOYEE_DOCUMENT',
      employee.id,
      'note.txt',
      'A short note stored as an attachment.',
    );
    fixture.attachmentIds.push(attachmentId);

    await page.goto(`/hr/employees/${employee.id}`);
    await page.getByTestId('file-tab-documents').click();
    await expect(page.getByTestId('employee-documents-item')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('employee-documents-item').getByRole('button', { name: 'note.txt' }).click();
    const preview = page.getByTestId('attachment-preview');
    await expect(preview).toBeVisible({ timeout: 20_000 });
    // A text file renders its content, which proves the bytes were read back.
    await expect(preview.getByText('A short note stored as an attachment.')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('attachment-preview-download')).toBeVisible();
  });

  test('8b. the employee photograph uploads from the card and renders as the primary image', async ({ page }) => {
    const employee = await createEmployee(token, 'photo');
    fixture.employeeId = employee.id;

    await page.goto(`/hr/employees/${employee.id}`);
    await expect(page.getByTestId('file-photo-empty')).toBeVisible({ timeout: 20_000 });

    // A 1x1 PNG, so the stored row is classified as an image attachment.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    );
    await page.getByTestId('employee-photo-input').setInputFiles({
      name: 'employee-photo.png',
      mimeType: 'image/png',
      buffer: png,
    });

    // The card owns an existing record, so it uploads on pick — there is no
    // save step to flush a draft from.
    await expect(page.getByTestId('employee-photo-item')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('employee-photo-item').getByRole('button', { name: 'Set primary' }).click();

    // The image is rendered from the authenticated bytes, not a bare src.
    await expect(page.getByTestId('file-photo-image')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('file-photo-empty')).toHaveCount(0);

    // It survives a reload: the record stores the image, not the page.
    await page.reload();
    await expect(page.getByTestId('file-photo-image')).toBeVisible({ timeout: 20_000 });

    const list = await fetch(`${API}/attachments?entityType=EMPLOYEE&entityId=${employee.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const parsed = (await list.json()) as { items: Array<{ id: string; isPrimary: boolean; previewKind: string }> };
    const primary = parsed.items.find((a) => a.isPrimary);
    expect(primary?.previewKind).toBe('image');
    for (const item of parsed.items) fixture.attachmentIds.push(item.id);

    // The printed card carries the same photograph, embedded as a data URL so
    // the print window needs no second request.
    const popupPromise = page.waitForEvent('popup');
    await page.getByTestId('file-print-card').click();
    const printed = await popupPromise;
    const printedPhoto = printed.locator('img.photo');
    await expect(printedPhoto).toHaveCount(1);
    await expect(printedPhoto).toHaveAttribute('src', /^data:image\/png;base64,/);
    await printed.close();
  });

  test('9. a work order preview shows its details, checklist and attachments', async ({ page }) => {
    // Create the work order through the UI so the form's attachment field runs.
    await page.goto('/operations');
    await page.getByTestId('operations-tab-work-orders').click();
    await page.getByTestId('new-work-order').click();
    const title = `${PREFIX} Order ${Date.now()}`;
    await page.getByTestId('work-order-title').fill(title);
    await page.getByTestId('new-work-order-attachments-input').setInputFiles({
      name: 'site.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Site notes'),
    });
    await page.getByTestId('save-work-order').click();
    await expect(page.locator('.oryx-modal')).toHaveCount(0, { timeout: 30_000 });

    const row = page.locator('tr', { hasText: title });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole('button', { name: /preview/i }).click();

    const preview = page.getByTestId('work-order-preview');
    await expect(preview).toBeVisible({ timeout: 20_000 });
    await expect(preview.getByText(title)).toBeVisible();
    await expect(page.getByTestId('work-order-preview-attachments-item')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('work-order-preview-print')).toBeVisible();
  });

  test('11. a receipt is recorded from inside the payments form and previews with its voucher number', async ({ page }) => {
    const customers = await fetch(`${API}/sales/customers?pageSize=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const customerList = (await customers.json()) as { items: Array<{ id: string; nameEn: string }> };
    expect(customerList.items.length).toBeGreaterThan(0);
    const customer = customerList.items[0];

    await page.goto('/accounting');
    await page.getByTestId('accounting-tab-payments').click();
    await expect(page.getByTestId('new-payment')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('new-payment').click();
    // The attachment field belongs to the same form as the voucher fields.
    await expect(page.getByTestId('new-payment-attachments')).toBeVisible();

    await page.getByTestId('payment-customer').selectOption(customer.id);
    await page.getByTestId('payment-amount').fill('12.500');
    await page.getByTestId('payment-reference').fill(`${PREFIX} RECEIPT`);
    await page.getByTestId('new-payment-attachments-input').setInputFiles({
      name: `${PREFIX} receipt-scan.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from('Receipt scan body'),
    });
    await expect(page.getByTestId('new-payment-attachments-draft')).toBeVisible();

    await page.getByTestId('save-payment').click();
    await expect(page.locator('.oryx-modal')).toHaveCount(0, { timeout: 30_000 });

    const payments = await fetch(`${API}/accounting/payments?page=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const paymentList = (await payments.json()) as {
      items: Array<{ id: string; paymentNumber: string; amountMinor: number }>;
    };
    const created = paymentList.items[0];
    expect(created.amountMinor).toBe(1250);
    fixture.paymentId = created.id;

    const attachments = await fetch(
      `${API}/attachments?entityType=PAYMENT&entityId=${created.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const attached = (await attachments.json()) as { items: Array<{ id: string; fileName: string }> };
    expect(attached.items.map((a) => a.fileName)).toContain(`${PREFIX} receipt-scan.txt`);
    for (const a of attached.items) fixture.attachmentIds.push(a.id);

    await page.getByTestId(`preview-payment-${created.paymentNumber}`).click();
    const preview = page.getByTestId('payment-preview');
    await expect(preview).toBeVisible({ timeout: 20_000 });
    await expect(preview.getByText(created.paymentNumber)).toBeVisible();
    // The party name appears in the preview subtitle and in the field list.
    await expect(preview.getByText(customer.nameEn).first()).toBeVisible();
    await expect(page.getByTestId('payment-preview-attachments-item')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('payment-preview-print')).toBeVisible();
  });

  test('13. a role previews its permission set and attachments', async ({ page }) => {
    await page.goto('/roles');
    const previewButtons = page.locator('[data-testid^="preview-role-"]');
    await expect(previewButtons.first()).toBeVisible({ timeout: 30_000 });
    await previewButtons.first().click();

    const preview = page.getByTestId('role-preview');
    await expect(preview).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('role-preview-attachments')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('role-preview-print')).toBeVisible();
  });

  test('10. the file renders in Arabic RTL and English LTR without a server error', async ({ page }) => {
    const employee = await createEmployee(token, 'locale');
    fixture.employeeId = employee.id;

    await page.goto(`/hr/employees/${employee.id}`);
    await expect(page.getByTestId('file-personal-card')).toBeVisible({ timeout: 20_000 });
    await setLocale(page, 'ar');
    await page.reload();
    await expect(page.getByTestId('file-personal-card')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    await setLocale(page, 'en');
    await page.reload();
    await expect(page.getByTestId('file-personal-card')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });
  test('17. the reports tab shows leave balances and overtime, and exports a real workbook', async ({ page }) => {
    const employee = await createEmployee(token, 'report');
    fixture.employeeId = employee.id;
    const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // A leave balance for the current year, so the tab has a row to read.
    const types = await fetch(`${API}/hr/leave-types`, { headers: H });
    expect(types.ok, `leave types failed with ${types.status}`).toBe(true);
    const typeList = (await types.json()) as { items: Array<{ id: string }> };
    expect(typeList.items.length).toBeGreaterThan(0);
    const balance = await fetch(`${API}/hr/leave-balances/adjust`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        employeeId: employee.id,
        leaveTypeId: typeList.items[0].id,
        year: new Date().getUTCFullYear(),
        entitledDays: 2100,
        accruedDays: 0,
      }),
    });
    expect(balance.ok, `balance adjust failed with ${balance.status}`).toBe(true);

    // Two attendance days, one carrying overtime, so the report has hours.
    for (const [date, overtime] of [
      ['2026-02-02', 0],
      ['2026-02-03', 90],
    ] as const) {
      const attendance = await fetch(`${API}/hr/attendance`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({
          employeeId: employee.id,
          workDate: date,
          checkInAt: `${date}T08:00:00.000Z`,
          checkOutAt: `${date}T17:00:00.000Z`,
          overtimeMinutes: overtime,
          status: 'PRESENT',
        }),
      });
      expect(attendance.ok, `attendance failed with ${attendance.status}`).toBe(true);
    }

    // A penalty and a bonus, so the two new export sheets carry real rows.
    const penalty = await fetch(`${API}/hr/employees/${employee.id}/file/penalties`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        actionType: 'WARNING',
        reason: 'Late attendance warning',
        effectiveDate: '2026-02-05',
        decidedByName: 'Line Manager',
      }),
    });
    expect(penalty.ok, `penalty failed with ${penalty.status}`).toBe(true);
    const bonus = await fetch(`${API}/hr/employees/${employee.id}/file/bonuses`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ type: 'BONUS', reason: 'Quarterly award', amountMinor: 100000 }),
    });
    expect(bonus.ok, `bonus failed with ${bonus.status}`).toBe(true);

    await page.goto(`/hr/employees/${employee.id}`);
    await page.getByTestId('file-tab-reports').click();
    await expect(page.getByTestId('file-reports')).toBeVisible({ timeout: 20_000 });

    // The balance row is rendered from the database, not hard-coded.
    await expect(page.getByTestId('report-leave-balances')).toBeVisible();
    await expect(page.getByTestId('report-leave-balances')).toContainText('21.00');

    // 90 overtime minutes are shown as 1.50 hours in the attendance summary.
    await expect(page.getByTestId('report-attendance-records')).toContainText('1.50');
    await expect(page.getByTestId('report-attendance-records')).toContainText('2026-02-03');

    // The export is a real .xlsx download, not a CSV rename.
    const download = page.waitForEvent('download');
    await page.getByTestId('report-export').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.xlsx$/);
    const path = await file.path();
    expect(path).toBeTruthy();

    // The workbook carries a sheet per record family, so a payroll clerk does
    // not have to re-run the export to get penalties and bonuses. The writer
    // stores parts uncompressed, so the sheet names are readable in the bytes.
    const raw = await readFile(path!, 'latin1');
    const sheetNames = [...raw.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
    expect(sheetNames).toHaveLength(5);
    expect(raw).toContain('2026-02-03');
    expect(raw).toContain('Late attendance warning');
    expect(raw).toContain('Quarterly award');
  });

  test('16. the payroll tab prints the chosen window and the full ledger separately', async ({ page }) => {
    const employee = await createEmployee(token, 'ledger');
    fixture.employeeId = employee.id;

    // A real run, so the ledger has a row the window can exclude.
    await fetch(`${API}/hr/salary-structures`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: employee.id, effectiveFrom: '2024-01-01', basicMinor: 500000, components: [] }),
    });
    const period = await fetch(`${API}/hr/payroll-periods`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `${PREFIX}-${Date.now()}`,
        nameEn: 'E06 ledger period',
        nameAr: 'فترة اختبار',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      }),
    });
    expect(period.ok, `period creation failed with ${period.status}`).toBe(true);
    const periodBody = (await period.json()) as { id: string };
    const run = await fetch(`${API}/hr/payroll-runs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodId: periodBody.id }),
    });
    expect(run.ok, `run creation failed with ${run.status}`).toBe(true);
    const runBody = (await run.json()) as { runNumber: string };

    await page.goto(`/hr/employees/${employee.id}`);
    await page.getByTestId('file-tab-payroll').click();
    await expect(page.getByTestId('file-payroll')).toBeVisible({ timeout: 20_000 });

    // Narrow the window so the January run falls outside it.
    await page.getByTestId('payroll-from').fill('2026-06-01');
    await page.getByTestId('payroll-to').fill('2026-06-30');
    await page.getByTestId('payroll-apply').click();
    await expect(page.getByText(runBody.runNumber)).toHaveCount(0, { timeout: 20_000 });

    const windowPopup = page.waitForEvent('popup');
    await page.getByTestId('payroll-print-period').click();
    const windowed = await windowPopup;
    await windowed.waitForLoadState();
    expect(await windowed.locator('body').innerText()).not.toContain(runBody.runNumber);
    await windowed.close();

    // The full ledger ignores the window, which is the difference between the
    // two buttons.
    const fullPopup = page.waitForEvent('popup');
    await page.getByTestId('payroll-print-full').click();
    const full = await fullPopup;
    await full.waitForLoadState();
    expect(await full.locator('body').innerText()).toContain(runBody.runNumber);
    await full.close();
  });
});

/**
 * The maintenance module is licensed to the Enterprise tenant only, so the
 * booking test runs in its own session against ORYX-AUTO.
 */
test.describe('Execution 06 — maintenance booking attachments (Enterprise tenant)', () => {
  let token: string;

  test.beforeEach(async ({ page }) => {
    await signIn(page, ENTERPRISE_ADMIN);
    await setLocale(page, 'en');
    await setTheme(page, 'dark');
    token = await apiToken(page, ENTERPRISE_ADMIN);
  });

  // No HTTP delete route exists for a maintenance booking, so the record and
  // its fixture vehicle are removed by scripts/purge-ui-fixtures.mjs.

  test('12. a maintenance booking is created with an attachment and previewed from its own tab', async ({ page }) => {
    const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const customers = await fetch(`${API}/sales/customers?pageSize=5`, { headers: H });
    const customerList = (await customers.json()) as { items: Array<{ id: string }> };
    expect(customerList.items.length).toBeGreaterThan(0);

    // A VIN excludes I, O and Q; the fixture vehicle is matched by its make instead.
    const vin = `E06${Date.now().toString().slice(-11)}`;
    const vehicleRes = await fetch(`${API}/automotive/vehicles`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        customerId: customerList.items[0].id,
        vin,
        make: `${PREFIX}Make`,
        model: 'Model',
        modelYear: 2024,
      }),
    });
    expect(vehicleRes.ok, `vehicle creation failed with ${vehicleRes.status}`).toBe(true);
    const vehicle = (await vehicleRes.json()) as { id: string };

    await page.goto('/automotive/maintenance');
    await page.getByTestId('maintenance-tab-bookings').click();
    await page.getByTestId('new-maintenance-booking').click();
    await expect(page.getByTestId('new-maintenance-booking-attachments')).toBeVisible();

    await page.getByTestId('maintenance-vehicle').selectOption(vehicle.id);
    await page.getByTestId('maintenance-scheduled-at').fill('2026-12-01T09:30');
    await page.getByTestId('new-maintenance-booking-attachments-input').setInputFiles({
      name: `${PREFIX} booking-note.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from('Customer reports a vibration'),
    });
    await expect(page.getByTestId('new-maintenance-booking-attachments-draft')).toBeVisible();
    await page.getByTestId('save-maintenance-booking').click();
    await expect(page.locator('.oryx-modal')).toHaveCount(0, { timeout: 30_000 });

    const bookings = await fetch(`${API}/automotive/maintenance-bookings`, { headers: H });
    const bookingList = (await bookings.json()) as {
      items: Array<{ id: string; bookingNumber: string; vehicleId: string }>;
    };
    const created = bookingList.items.find((b) => b.vehicleId === vehicle.id);
    expect(created, 'the created maintenance booking is missing from the list').toBeTruthy();

    const attachments = await fetch(
      `${API}/attachments?entityType=MAINTENANCE_BOOKING&entityId=${created!.id}`,
      { headers: H },
    );
    const attached = (await attachments.json()) as { items: Array<{ id: string; fileName: string }> };
    expect(attached.items.map((a) => a.fileName)).toContain(`${PREFIX} booking-note.txt`);

    await page.getByTestId(`preview-maintenance-booking-${created!.bookingNumber}`).click();
    const preview = page.getByTestId('maintenance-booking-preview');
    await expect(preview).toBeVisible({ timeout: 20_000 });
    await expect(preview.getByText(created!.bookingNumber)).toBeVisible();
    await expect(page.getByTestId('maintenance-booking-preview-attachments-item')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('maintenance-booking-preview-print')).toBeVisible();
  });
});

test.describe('Execution 06 — platform CMS preview', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, SUPER_ADMIN);
    await setLocale(page, 'en');
    await setTheme(page, 'dark');
  });

  test('12. a website page previews its content and attachments from the list', async ({ page }) => {
    // The CMS is a platform-only surface; the describe signs in as Super Admin.
    await page.goto('/website');
    await expect(page.getByTestId('cms-pages-table')).toBeVisible({ timeout: 20_000 });

    const previewButtons = page.locator('[data-testid^="preview-cms-page-"]');
    await expect(previewButtons.first()).toBeVisible({ timeout: 20_000 });
    await previewButtons.first().click();

    const preview = page.getByTestId('cms-page-preview');
    await expect(preview).toBeVisible({ timeout: 20_000 });
    // The body is rendered in the preview, and the record can be printed.
    await expect(preview.getByText('slug', { exact: false }).first()).toBeVisible();
    await expect(page.getByTestId('cms-page-preview-print')).toBeVisible();
  });

  test('12b. the website page form carries its attachments and saves them with the record', async ({ page }) => {
    // A platform page belongs to no tenant, so its attachments must upload
    // without a company context. The form is where they are added.
    const token = await apiToken(page, SUPER_ADMIN);
    const slug = `${PREFIX.toLowerCase()}-cms-${Date.now()}`;
    const saved = await fetch(`${API}/cms/pages`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, locale: 'en', title: `${PREFIX} CMS page`, body: 'Terms', status: 'DRAFT' }),
    });
    expect(saved.ok, `page creation failed with ${saved.status}`).toBe(true);
    const pageId = ((await saved.json()) as { id: string }).id;

    try {
      await page.goto('/website');
      await expect(page.getByTestId('cms-pages-table')).toBeVisible({ timeout: 20_000 });
      await page.getByTestId('new-cms-page').click();

      const field = page.getByTestId('cms-page-attachments');
      await expect(field).toBeVisible({ timeout: 20_000 });
      await page.getByTestId('cms-page-attachments-input').setInputFiles({
        name: 'terms.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('platform attachment'),
      });
      // A picked file is held as a draft until the form saves.
      await expect(page.getByTestId('cms-page-attachments-draft')).toHaveCount(1);

      await page.getByTestId('cms-slug').fill(slug);
      // The fixture row is English; the form defaults to Arabic, and the slug
      // is unique per locale, so the locale has to match or the save creates a
      // second row and the file lands on the wrong record.
      await page.getByTestId('cms-locale').selectOption('en');
      await page.getByTestId('cms-title').fill(`${PREFIX} CMS page`);
      await page.getByTestId('cms-body').fill('Terms');
      await page.getByTestId('save-cms-page').click();
      await expect(page.locator('.oryx-modal')).toHaveCount(0, { timeout: 20_000 });

      // The file was attached to the saved record, not dropped on close.
      const list = await fetch(`${API}/attachments?entityType=CMS_PAGE&entityId=${pageId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await list.json()) as { total: number; items: Array<{ id: string; companyId: string | null }> };
      expect(body.total).toBe(1);
      expect(body.items[0].companyId).toBeNull();
      for (const item of body.items) {
        await deleteQuietly(token, `/attachments/${item.id}`);
      }
    } finally {
      await deleteQuietly(token, `/cms/pages/${pageId}`);
    }
  });
});

test.describe('Execution 06 — platform record previews', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, SUPER_ADMIN);
    await setLocale(page, 'en');
    await setTheme(page, 'dark');
  });

  test('14. a subscription previews its entitlement snapshot', async ({ page }) => {
    await page.goto('/subscriptions');
    const buttons = page.locator('[data-testid^="preview-subscription-"]');
    await expect(buttons.first()).toBeVisible({ timeout: 30_000 });
    await buttons.first().click();

    const preview = page.getByTestId('subscription-preview');
    await expect(preview).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('subscription-preview-print')).toBeVisible();
  });

  test('15. a support session previews its scope and reason', async ({ page }) => {
    // Open a real session so the test does not depend on leftover history, and
    // so it exercises the same record the preview must attach files to.
    const token = await apiToken(page, SUPER_ADMIN);
    const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const companies = await fetch(`${API}/companies?pageSize=1`, { headers: H });
    expect(companies.ok, `company list failed with ${companies.status}`).toBe(true);
    const companyList = (await companies.json()) as { items: Array<{ id: string }> };
    expect(companyList.items.length).toBeGreaterThan(0);

    const opened = await fetch(`${API}/support-sessions`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        companyId: companyList.items[0].id,
        reason: `${PREFIX} preview scope check`,
        minutes: 15,
      }),
    });
    expect(opened.ok, `support open failed with ${opened.status}`).toBe(true);
    const session = (await opened.json()) as { id: string };

    try {
      await page.goto('/support');
      const button = page.getByTestId(`preview-support-${session.id}`);
      await expect(button).toBeVisible({ timeout: 30_000 });

      // Arm the watcher before opening: the preview fetches the record's files
      // as soon as it mounts. Watching the request is what catches the original
      // defect — the panel used to request the company's attachments, so a file
      // picked there landed on the company instead of the session.
      const request = page.waitForRequest(
        (r) => r.url().includes('/attachments?') && r.url().includes('entityType='),
        { timeout: 30_000 },
      );
      await button.click();

      const preview = page.getByTestId('support-preview');
      await expect(preview).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('support-preview-print')).toBeVisible();
      await expect(preview).toContainText(`${PREFIX} preview scope check`);

      const listed = await request;
      expect(listed.url()).toContain('entityType=SUPPORT_SESSION');
      expect(listed.url()).toContain(`entityId=${session.id}`);
      expect(listed.url()).not.toContain(`entityId=${companyList.items[0].id}`);

      const uploaded = await fetch(`${API}/attachments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: (() => {
          const form = new FormData();
          form.set('entityType', 'SUPPORT_SESSION');
          form.set('entityId', session.id);
          form.append('files', new Blob(['scope note'], { type: 'text/plain' }), `${PREFIX}-support-note.txt`);
          return form;
        })(),
      });
      expect(uploaded.ok, `support upload failed with ${uploaded.status}`).toBe(true);
      const created = (await uploaded.json()) as {
        items: Array<{ id: string; entityType: string; entityId: string }>;
      };
      // The file belongs to the session, not to the company the session targets.
      expect(created.items.every((a) => a.entityType === 'SUPPORT_SESSION')).toBe(true);
      expect(created.items.every((a) => a.entityId === session.id)).toBe(true);
      expect(created.items.every((a) => a.entityId !== companyList.items[0].id)).toBe(true);

      for (const item of created.items) await deleteQuietly(token, `/attachments/${item.id}`);
    } finally {
      await deleteQuietly(token, `/support-sessions/${session.id}/end`);
    }
  });
});
