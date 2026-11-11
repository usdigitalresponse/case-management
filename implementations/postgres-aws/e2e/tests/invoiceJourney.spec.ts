import { expect, test, type Page } from '@playwright/test';

// Through the sign-in page's demo sign-in, as the first seeded account with this role.
async function signIn(page: Page, who: 'staff' | 'partner', role: string) {
  await page.goto('/');
  const form = page.locator('form.login-demo').filter({ has: page.locator(`#demo-${who}`) });
  const value = await form.locator('option', { hasText: `(${role})` }).first().getAttribute('value');
  await form.locator('select').selectOption(value!);
  await form.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('form.login-demo')).toHaveCount(0);
}

// One invoice from upload to a finished review; each step needs the one before.
test.describe.serial('an invoice from upload to review', () => {
  const invoiceNumber = `E2E-${Date.now()}`;
  let invoiceId = '';

  test('a sender uploads an invoice, checks it and sends it', async ({ page }) => {
    await signIn(page, 'partner', 'Attorney');
    const csv = [
      'invoice_number,case,date,type,timekeeper,description,hours,rate,amount,task_code,activity_code,expense_code',
      `${invoiceNumber},26-E2E-0001,2026-10-05,time,,Reviewing discovery,1.5,100,150,,,`,
      `${invoiceNumber},26-E2E-0001,2026-10-06,time,,Client meeting,1,100,100,,,`,
    ].join('\n');

    await page.goto('/portal/upload');
    await page.locator('input[type="file"]').setInputFiles({ name: `${invoiceNumber}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.waitForURL(/\/portal\/invoices\/[0-9a-f-]{36}$/);
    invoiceId = page.url().split('/').pop()!;
    await page.getByRole('button', { name: 'Send for review' }).click();
    const dialog = page.getByRole('dialog');
    const send = dialog.getByRole('button', { name: 'Send for review' });
    await expect(send).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    await send.click();

    await expect(page.getByText(/Sent for review on/)).toBeVisible();
  });

  test('a reviewer decides every line and finishes the review', async ({ page }) => {
    await signIn(page, 'staff', 'Staff');
    await page.goto(`/billing/${invoiceId}`);
    const undecided = page.getByRole('group', { name: 'Decide this line' });
    await expect(undecided).toHaveCount(2);

    for (let left = 2; left > 0; left -= 1) {
      await undecided.first().getByRole('button', { name: 'Approve', exact: true }).click();
      await expect(undecided).toHaveCount(left - 1);
    }
    await page.getByRole('button', { name: 'Finish review' }).click();
    await page.getByRole('dialog', { name: 'Finish this review?' }).getByRole('button', { name: 'Finish review' }).click();

    await expect(page.getByText(/^Review finished\./)).toBeVisible();
  });
});
