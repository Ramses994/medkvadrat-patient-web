import { expect, test, type Browser, type Page } from '@playwright/test';

async function login(page: Page, phone = '+7 900 000-00-00', code = '123456') {
  const loginVisible = await page
    .getByRole('heading', { name: 'Вход' })
    .isVisible()
    .catch(() => false);
  if (!loginVisible) {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
  }
  await page.getByLabel('Телефон').fill('');
  await page.getByLabel('Телефон').fill(phone);
  await page.getByRole('button', { name: 'Получить код' }).click();
  await expect(page.getByLabel('Код')).toBeVisible();
  await page.getByLabel('Код').fill(code);
  await page.getByRole('button', { name: 'Войти' }).click();
}

async function twoPages(browser: Browser) {
  const context = await browser.newContext();
  const page1 = await context.newPage();
  const page2 = await context.newPage();
  return { context, page1, page2 };
}

test('Ч2-1: tab A after tab B login shows login without B data (access expiry / session change)', async ({
  browser,
}) => {
  const { context, page1, page2 } = await twoPages(browser);
  await page1.goto('/');
  await page2.goto('/');
  await login(page1);
  await expect(page1.getByText('Петров Пётр Петрович')).toBeVisible();
  await login(page2, '+7 900 000-00-00', 'CodeB');
  await expect(page2.getByText('Козлов Козьма Козьмич')).toBeVisible();

  // Cross-tab «login» with another session clears tab1; access expiry would also end it.
  await expect(page1.getByRole('heading', { name: 'Вход' })).toBeVisible();
  await expect(page1.getByText('Козлов Козьма Козьмич')).toHaveCount(0);
  await expect(page1.getByText('Иванова Мария Ивановна')).toHaveCount(0);
  await expect(page1.getByText('Петров Пётр Петрович')).toHaveCount(0);

  // If still on cabinet somehow, force 401→refresh SESSION_CHANGED path.
  if (await page1.getByRole('button', { name: 'Профиль' }).isVisible().catch(() => false)) {
    await page1.route('**/api/me/**', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error_details: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
        }),
      });
    });
    await page1.getByRole('button', { name: 'Профиль' }).click();
    await expect(page1.getByRole('heading', { name: 'Вход' })).toBeVisible();
  }
  await context.close();
});

test('Ч2-2: delayed logout then F5 shows login; logout reached API', async ({ page }) => {
  let logoutHits = 0;
  let logoutDone!: () => void;
  const logoutFinished = new Promise<void>((r) => {
    logoutDone = r;
  });
  await page.route('**/api/auth/logout', async (route) => {
    logoutHits += 1;
    await new Promise((r) => setTimeout(r, 2_000));
    await route.continue();
    logoutDone();
  });

  await login(page);
  await expect(page.getByText('Петров Пётр Петрович')).toBeVisible();
  await page.getByRole('button', { name: 'Выйти' }).first().click();
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible({ timeout: 2000 });
  expect(logoutHits).toBeGreaterThanOrEqual(1);
  await logoutFinished;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
});

test('Ч2-3: delayed config in tab1 while tab2 logs out — tab1 stays on login, no refresh', async ({
  browser,
}) => {
  const { context, page1, page2 } = await twoPages(browser);
  let refreshFrom1 = 0;

  await page1.route('**/runtime-config.json', async (route) => {
    await new Promise((r) => setTimeout(r, 3_000));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ clinic_phone: '+7 900 000-00-00' }),
    });
  });
  await page1.route('**/api/auth/refresh', async (route) => {
    refreshFrom1 += 1;
    await route.continue();
  });

  const p1Nav = page1.goto('/');
  await page2.goto('/');
  await login(page2);
  await expect(page2.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
  await page2.getByRole('button', { name: 'Выйти' }).first().click();
  await expect(page2.getByRole('heading', { name: 'Вход' })).toBeVisible();

  await p1Nav;
  await expect(page1.getByRole('heading', { name: 'Вход' })).toBeVisible({ timeout: 10_000 });
  expect(refreshFrom1).toBe(0);
  await context.close();
});

test('Ч2-4: logout in tab1 shows login in tab2 without second logout', async ({ browser }) => {
  const { context, page1, page2 } = await twoPages(browser);
  let logoutHits = 0;
  await page1.route('**/api/auth/logout', async (route) => {
    logoutHits += 1;
    await route.continue();
  });
  await page2.route('**/api/auth/logout', async (route) => {
    logoutHits += 1;
    await route.continue();
  });

  await login(page1);
  await page2.goto('/');
  await expect(page2.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
  await page1.getByRole('button', { name: 'Выйти' }).first().click();
  await expect(page1.getByRole('heading', { name: 'Вход' })).toBeVisible();
  await expect(page2.getByRole('heading', { name: 'Вход' })).toBeVisible();
  expect(logoutHits).toBe(1);
  await context.close();
});

test('Ч2-5: two tabs open after login — same patient, session alive', async ({ browser }) => {
  const { context, page1, page2 } = await twoPages(browser);
  await login(page1);
  await expect(page1.getByText('Петров Пётр Петрович')).toBeVisible();
  await page2.goto('/');
  await expect(page2.getByText('Петров Пётр Петрович')).toBeVisible();
  await page1.reload();
  await expect(page1.getByText('Петров Пётр Петрович')).toBeVisible();
  await context.close();
});

test('Ч2-6: tab1 was A; tab2 logout+login B; F5 in tab1 never shows A', async ({ browser }) => {
  const { context, page1, page2 } = await twoPages(browser);
  await login(page1);
  await expect(page1.getByText('Петров Пётр Петрович')).toBeVisible();
  await page2.goto('/');
  await expect(page2.getByText('Петров Пётр Петрович')).toBeVisible();
  await page2.getByRole('button', { name: 'Выйти' }).first().click();
  await expect(page2.getByRole('heading', { name: 'Вход' })).toBeVisible();
  await login(page2, '+7 900 000-00-00', 'CodeB');
  await expect(page2.getByText('Козлов Козьма Козьмич')).toBeVisible();

  await page1.reload();
  await expect(page1.getByText('Петров Пётр Петрович')).toHaveCount(0);
  const loginOrB = await Promise.race([
    page1
      .getByRole('heading', { name: 'Вход' })
      .waitFor({ state: 'visible' })
      .then(() => 'login' as const),
    page1
      .getByText('Козлов Козьма Козьмич')
      .waitFor({ state: 'visible' })
      .then(() => 'B' as const),
  ]);
  expect(loginOrB === 'login' || loginOrB === 'B').toBe(true);
  await context.close();
});

test('Ч2-7: login A → logout → login B with delayed A responses → only B', async ({ page }) => {
  let releaseRefresh!: () => void;
  const held = new Promise<void>((r) => {
    releaseRefresh = r;
  });
  let armHold = false;

  await page.route('**/api/auth/refresh', async (route) => {
    if (armHold) {
      armHold = false;
      await held;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'Set-Cookie': 'lk_refresh=stale-A; Path=/api/auth; HttpOnly; SameSite=Strict',
        },
        body: JSON.stringify({
          success: true,
          data: { access: 'access-stale-A', access_expires_in: 900, session: 'sid-stale-A' },
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.route('**/api/me/**', async (route) => {
    const auth = route.request().headers()['authorization'] || '';
    if (auth.includes('access-stale-A')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: route.request().url().includes('profile')
            ? {
                patient_id: 1,
                full_name: 'Пациент Сессия А',
                phone: '+79000000000',
                email: 'a@example.test',
              }
            : [
                {
                  planning_id: 1,
                  starts_at: '2099-01-01 10:00',
                  duration_min: 10,
                  state: 'scheduled',
                  is_waitlist: false,
                  branch: { id: 1, name: 'A', address: 'A' },
                  doctor: { id: 1, name: 'Доктор Сессия А' },
                  exam_name: 'A',
                  confirmation: 'confirmed',
                },
              ],
        }),
      });
      return;
    }
    await route.continue();
  });

  await login(page);
  await expect(page.getByText('Петров Пётр Петрович')).toBeVisible();

  let profile401 = false;
  await page.route('**/api/me/profile', async (route) => {
    if (!profile401) {
      profile401 = true;
      armHold = true;
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
    await route.fallback();
  });

  await page.getByRole('button', { name: 'Профиль' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Выйти' }).first().click();
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
  await login(page, '+7 900 000-00-00', 'CodeB');
  await expect(page.getByText('Козлов Козьма Козьмич')).toBeVisible();

  releaseRefresh();
  await page.waitForTimeout(800);
  await expect(page.getByText('Доктор Сессия А')).toHaveCount(0);
  await expect(page.getByText('Пациент Сессия А')).toHaveCount(0);
  await expect(page.getByText('Козлов Козьма Козьмич')).toBeVisible();
});
