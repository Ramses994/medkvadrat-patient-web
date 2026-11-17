import { expect, test, type Browser, type Page } from '@playwright/test';

async function login(page: Page, phone = '+7 900 000-00-00', code = '123456') {
  const loginVisible = await page
    .getByRole('heading', { name: 'Вход' })
    .isVisible()
    .catch(() => false);
  if (!loginVisible) {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible({ timeout: 15_000 });
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

test('Ш6-1: cabinet in tab1, tab2 shows already open with no API', async ({ browser }) => {
  const { context, page1, page2 } = await twoPages(browser);
  let apiFrom2 = 0;
  await page2.route('**/api/**', async (route) => {
    apiFrom2 += 1;
    await route.continue();
  });

  await page1.goto('/');
  await login(page1);
  await expect(page1.getByRole('heading', { name: 'Мои записи' })).toBeVisible();

  await page2.goto('/');
  await expect(
    page2.getByRole('heading', { name: 'Личный кабинет уже открыт в другой вкладке' }),
  ).toBeVisible();
  expect(apiFrom2).toBe(0);
  await context.close();
});

test('Ш6-2: Open here moves cabinet without logout', async ({ browser }) => {
  const { context, page1, page2 } = await twoPages(browser);
  let logoutHits = 0;
  for (const p of [page1, page2]) {
    await p.route('**/api/auth/logout', async (route) => {
      logoutHits += 1;
      await route.continue();
    });
  }

  await page1.goto('/');
  await login(page1);
  await expect(page1.getByText('Петров Пётр Петрович')).toBeVisible();

  await page2.goto('/');
  await expect(
    page2.getByRole('heading', { name: 'Личный кабинет уже открыт в другой вкладке' }),
  ).toBeVisible();
  await page2.getByRole('button', { name: 'Открыть здесь' }).click();

  await expect(page1.getByRole('heading', { name: 'Кабинет открыт в другой вкладке' })).toBeVisible();
  await expect(page1.getByText('Петров Пётр Петрович')).toHaveCount(0);
  await expect(page2.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
  await expect(page2.getByText('Петров Пётр Петрович')).toBeVisible();
  expect(logoutHits).toBe(0);
  await context.close();
});

test('Ш6-3: close tab1, F5 on tab2 opens cabinet', async ({ browser }) => {
  const { context, page1, page2 } = await twoPages(browser);
  await page1.goto('/');
  await login(page1);
  await expect(page1.getByRole('heading', { name: 'Мои записи' })).toBeVisible();

  await page2.goto('/');
  await expect(
    page2.getByRole('heading', { name: 'Личный кабинет уже открыт в другой вкладке' }),
  ).toBeVisible();
  await page1.close();
  // Lock release after close can lag briefly; reload until this tab can boot.
  await expect
    .poll(
      async () => {
        await page2.reload();
        return page2.getByRole('heading', { name: 'Мои записи' }).isVisible();
      },
      { timeout: 15_000, intervals: [200, 400, 800] },
    )
    .toBe(true);
  await context.close();
});

test('Ш6-4: delayed logout then F5 before reply — login, no refresh, logout reached', async ({
  page,
}) => {
  let logoutHits = 0;
  let refreshHits = 0;
  let releaseLogout!: () => void;
  const held = new Promise<void>((r) => {
    releaseLogout = r;
  });

  await page.route('**/api/auth/logout', async (route) => {
    logoutHits += 1;
    // Hold only the first (manual) logout; the post-F5 flag logout must finish.
    if (logoutHits === 1) {
      await held;
      await route.continue();
      return;
    }
    await route.fulfill({ status: 204 });
  });
  await page.route('**/api/auth/refresh', async (route) => {
    refreshHits += 1;
    await route.continue();
  });

  await login(page);
  await expect(page.getByText('Петров Пётр Петрович')).toBeVisible();
  refreshHits = 0;
  await page.getByRole('button', { name: 'Выйти' }).first().click();
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible({ timeout: 2000 });
  expect(logoutHits).toBeGreaterThanOrEqual(1);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
  expect(refreshHits).toBe(0);
  releaseLogout();
  await page.waitForTimeout(300);
  expect(logoutHits).toBeGreaterThanOrEqual(1);
});

test('Э1-1: logout response then login then F5 keeps cabinet', async ({ page }) => {
  let logoutDone = false;
  await page.route('**/api/auth/logout', async (route) => {
    await route.continue();
    logoutDone = true;
  });

  await login(page);
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
  await page.getByRole('button', { name: 'Выйти' }).first().click();
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
  await expect.poll(() => logoutDone).toBe(true);

  await login(page);
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Вход' })).toHaveCount(0);
});

test('Э1-2: logout delayed >5s then login then F5 — cabinet, no second logout', async ({
  page,
}) => {
  let logoutHits = 0;
  await page.route('**/api/auth/logout', async (route) => {
    logoutHits += 1;
    await new Promise((r) => setTimeout(r, 8_000));
    await route.fulfill({ status: 204 });
  });

  await login(page);
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
  await page.getByRole('button', { name: 'Выйти' }).first().click();
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible({ timeout: 2000 });
  expect(logoutHits).toBe(1);

  // OTP unlocks after LOGOUT_TIMEOUT_MS (5s) even while logout is still held.
  await page.waitForTimeout(5_100);
  await login(page);
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible({ timeout: 15_000 });
  const hitsAfterLogin = logoutHits;

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
  expect(logoutHits).toBe(hitsAfterLogin);
});

test('Ш6-5: 5 min session left, clocks +6 min → login', async ({ page }) => {
  await page.clock.install();
  await page.route('**/api/auth/otp/verify', async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    if (json?.data?.access) {
      json.data.access_expires_in = 300;
    }
    await route.fulfill({
      status: res.status(),
      contentType: 'application/json',
      headers: { 'Set-Cookie': res.headers()['set-cookie'] || '' },
      body: JSON.stringify(json),
    });
  });
  await page.route('**/api/auth/refresh', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        error_details: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
      }),
    });
  });

  await login(page);
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
  await page.getByRole('button', { name: 'Профиль' }).click();
  await page.clock.fastForward(6 * 60 * 1000);
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible({ timeout: 10_000 });
});

test('Ш6-6: login A → logout → login B with delayed A → only B', async ({ page }) => {
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
          data: {
            patient_id: 1,
            full_name: 'Пациент Сессия А',
            phone: '+79000000000',
            email: 'a@example.test',
          },
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
  await expect(page.getByText('Пациент Сессия А')).toHaveCount(0);
  await expect(page.getByText('Козлов Козьма Козьмич')).toBeVisible();
});

test('Ш4: manual logout body includes session id', async ({ page }) => {
  let logoutBody = '';
  await page.route('**/api/auth/logout', async (route) => {
    logoutBody = route.request().postData() || '';
    await route.continue();
  });
  await login(page);
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
  await page.getByRole('button', { name: 'Выйти' }).first().click();
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
  expect(JSON.parse(logoutBody).session).toMatch(/^sid-/);
});

test('Ш4: idle logout body includes session id', async ({ page }) => {
  await page.clock.install();
  let logoutBody = '';
  await page.route('**/api/auth/logout', async (route) => {
    logoutBody = route.request().postData() || '';
    await route.continue();
  });
  await login(page);
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
  await page.clock.fastForward(15 * 60 * 1000 + 1000);
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible({ timeout: 10_000 });
  expect(JSON.parse(logoutBody).session).toMatch(/^sid-/);
});

test('Ш6-7: two tabs open simultaneously — one cabinet, one already open', async ({ browser }) => {
  const { context, page1, page2 } = await twoPages(browser);
  const p1 = page1.goto('/');
  const p2 = page2.goto('/');
  await Promise.all([p1, p2]);

  const h1Blocked = page1.getByRole('heading', { name: 'Личный кабинет уже открыт в другой вкладке' });
  const h2Blocked = page2.getByRole('heading', { name: 'Личный кабинет уже открыт в другой вкладке' });
  const h1Login = page1.getByRole('heading', { name: 'Вход' });
  const h2Login = page2.getByRole('heading', { name: 'Вход' });

  await expect
    .poll(async () => {
      const b1 = await h1Blocked.isVisible().catch(() => false);
      const b2 = await h2Blocked.isVisible().catch(() => false);
      const l1 = await h1Login.isVisible().catch(() => false);
      const l2 = await h2Login.isVisible().catch(() => false);
      const cabinets = (l1 ? 1 : 0) + (l2 ? 1 : 0);
      const blocked = (b1 ? 1 : 0) + (b2 ? 1 : 0);
      return cabinets === 1 && blocked === 1;
    })
    .toBe(true);

  await context.close();
});
