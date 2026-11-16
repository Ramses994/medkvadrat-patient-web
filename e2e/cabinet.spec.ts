import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, phone = '+7 900 000-00-00', code = '123456') {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
  await page.getByLabel('Телефон').fill('');
  await page.getByLabel('Телефон').fill(phone);
  await page.getByRole('button', { name: 'Получить код' }).click();
  await expect(page.getByLabel('Код')).toBeVisible();
  await page.getByLabel('Код').fill(code);
  await page.getByRole('button', { name: 'Войти' }).click();
}

test('login shows upcoming appointments', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
  await expect(page.getByText('Петров Пётр Петрович')).toBeVisible();
  await expect(page.getByText('Вы записаны')).toBeVisible();
});

test('login with profile choice', async ({ page }) => {
  await login(page, '+7 900 000-00-01', '123456');
  await expect(page.getByRole('heading', { name: 'Выберите профиль' })).toBeVisible();
  await page.getByRole('button', { name: /Иванов Иван Иванович/ }).click();
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
});

test('F5 keeps the session', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Вход' })).toHaveCount(0);
});

test('expired access token refreshes quietly', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();

  let profileHits = 0;
  await page.route('**/api/me/profile', async (route) => {
    profileHits += 1;
    if (profileHits === 1) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error_details: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.getByRole('button', { name: 'Профиль' }).click();
  await expect(page.getByText('Иванов Иван Иванович')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Вход' })).toHaveCount(0);
  expect(profileHits).toBeGreaterThanOrEqual(2);
});

test('logout returns to login', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Выйти' }).first().click();
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
});

test('browser storages stay empty after login', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
  const storage = await page.evaluate(async () => {
    const ls = { ...localStorage };
    const ss = { ...sessionStorage };
    let idb = 0;
    if (indexedDB.databases) {
      idb = (await indexedDB.databases()).length;
    }
    return { ls, ss, idb };
  });
  expect(storage.ls).toEqual({});
  expect(storage.ss).toEqual({});
  expect(storage.idb).toBe(0);
});

test('long pilot code is accepted', async ({ page }) => {
  await login(page, '+7 900 000-00-00', 'PilotCode2026Demo');
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
});

test('width 360 has no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await login(page);
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
  const scrolled = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 1;
  });
  expect(scrolled).toBe(false);
});
