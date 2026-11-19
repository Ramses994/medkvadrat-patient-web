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

function waitingMessage(page: Page) {
  return page.getByRole('heading', { name: 'Личный кабинет открыт в другой вкладке' });
}

async function stubRefreshDelay(page: Page, ms: number) {
  await page.evaluate(async (delay) => {
    await fetch('/api/stub/refresh-delay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ms: delay }),
    });
  }, ms);
}

async function setVerifyExpiresIn(page: Page, sec: number) {
  await page.route('**/api/auth/otp/verify', async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    if (json?.data?.access) {
      json.data.access_expires_in = sec;
    }
    await route.fulfill({
      status: res.status(),
      contentType: 'application/json',
      headers: { 'Set-Cookie': res.headers()['set-cookie'] || '' },
      body: JSON.stringify(json),
    });
  });
}

test('Ш6-1: cabinet in tab1, tab2 shows waiting with no API', async ({ browser }) => {
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
  await expect(waitingMessage(page2)).toBeVisible();
  await expect(page2.getByText('Закройте её — кабинет откроется здесь')).toBeVisible();
  expect(apiFrom2).toBe(0);
  await context.close();
});

test('Ш6-2 / Ю3-5: close tab1 → tab2 gets cabinet without Open here', async ({ browser }) => {
  const { context, page1, page2 } = await twoPages(browser);
  let apiFrom2 = 0;
  await page2.route('**/api/**', async (route) => {
    apiFrom2 += 1;
    await route.continue();
  });

  await page1.goto('/');
  await login(page1);
  await expect(page1.getByText('Петров Пётр Петрович')).toBeVisible();

  await page2.goto('/');
  await expect(waitingMessage(page2)).toBeVisible();
  expect(apiFrom2).toBe(0);

  await page1.close();
  await expect(page2.getByRole('heading', { name: 'Мои записи' })).toBeVisible({ timeout: 15_000 });
  await expect(page2.getByText('Петров Пётр Петрович')).toBeVisible();
  await context.close();
});

test('Ш6-3: close tab1 while tab2 waiting → cabinet without reload', async ({ browser }) => {
  const { context, page1, page2 } = await twoPages(browser);
  await page1.goto('/');
  await login(page1);
  await expect(page1.getByRole('heading', { name: 'Мои записи' })).toBeVisible();

  await page2.goto('/');
  await expect(waitingMessage(page2)).toBeVisible();
  await page1.close();
  await expect(page2.getByRole('heading', { name: 'Мои записи' })).toBeVisible({ timeout: 15_000 });
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

  await page.waitForTimeout(5_100);
  await login(page);
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible({ timeout: 15_000 });
  const hitsAfterLogin = logoutHits;

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
  expect(logoutHits).toBe(hitsAfterLogin);
});

test('Ю3-1: displayUntil + delayed refresh 401 → checking then login', async ({ page }) => {
  await page.clock.install();
  await setVerifyExpiresIn(page, 300);
  await login(page);
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
  await page.getByRole('button', { name: 'Профиль' }).click();
  await expect(page.getByText('Иванов Иван Иванович')).toBeVisible();

  // Real stub delay (Node timers), not a held Promise; always reset after the test.
  await stubRefreshDelay(page, 1_500);
  try {
    await page.route('**/api/auth/refresh', async (route) => {
      // Hit stub so refreshDelayMs applies (real wall time), then force 401.
      await route.fetch();
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error_details: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
        }),
      });
    });

    await page.clock.fastForward(6 * 60 * 1000);
    await expect(page.getByRole('heading', { name: 'Проверяем сессию…' })).toBeVisible();
    await expect(page.getByText('Иванов Иван Иванович')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible({ timeout: 10_000 });
  } finally {
    await stubRefreshDelay(page, 0);
  }
});

test('Ю3-2: displayUntil after hidden→visible → checking then login', async ({ page }) => {
  await page.clock.install();
  await setVerifyExpiresIn(page, 300);
  await login(page);
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();

  let releaseRefresh!: () => void;
  const held = new Promise<void>((r) => {
    releaseRefresh = r;
  });
  await page.route('**/api/auth/refresh', async (route) => {
    await held;
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        error_details: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
      }),
    });
  });

  // Expire displayUntil while "hidden", then resume via visibilitychange.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(6 * 60 * 1000);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await expect(page.getByRole('heading', { name: 'Проверяем сессию…' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toHaveCount(0);

  releaseRefresh();
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible({ timeout: 10_000 });
});

test('Ю3-3: 30s TTL, successful refresh — at most two refresh in 60s', async ({ page }) => {
  await page.clock.install();
  let refreshHits = 0;
  await setVerifyExpiresIn(page, 30);
  await page.route('**/api/auth/refresh', async (route) => {
    refreshHits += 1;
    const res = await route.fetch();
    const json = await res.json();
    if (json?.data?.access) json.data.access_expires_in = 30;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const setCookie = res.headers()['set-cookie'];
    if (setCookie) headers['Set-Cookie'] = setCookie;
    await route.fulfill({ status: res.status(), headers, body: JSON.stringify(json) });
  });

  await login(page);
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
  refreshHits = 0;

  // Two 30s steps (not one 60s jump) so preempt/display timers can fire between.
  await page.clock.fastForward(30_000);
  await page.waitForTimeout(300);
  await page.clock.fastForward(30_000);
  await page.waitForTimeout(500);
  expect(refreshHits).toBeLessThanOrEqual(2);
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
});

test('Ю3-4: delayed logout, close tab1 → tab2 login after revoke', async ({ browser }) => {
  const { context, page1, page2 } = await twoPages(browser);
  let releaseLogout!: () => void;
  const held = new Promise<void>((r) => {
    releaseLogout = r;
  });
  let logoutSession = '';

  await page1.route('**/api/auth/logout', async (route) => {
    try {
      logoutSession = String(JSON.parse(route.request().postData() || '{}').session || '');
    } catch {
      logoutSession = '';
    }
    await held;
    await route.continue();
  });

  await page1.goto('/');
  await login(page1);
  await expect(page1.getByRole('heading', { name: 'Мои записи' })).toBeVisible();

  await page2.goto('/');
  await expect(waitingMessage(page2)).toBeVisible();

  await page1.getByRole('button', { name: 'Выйти' }).first().click();
  await expect(page1.getByRole('heading', { name: 'Вход' })).toBeVisible();
  releaseLogout();
  await page1.waitForTimeout(400);

  // Server-side session revoke in stub API (not only the login screen).
  expect(logoutSession).toMatch(/^sid-/);
  const live = await page1.evaluate(async (sid) => {
    const res = await fetch(`/api/stub/sid-live?sid=${encodeURIComponent(sid)}`);
    return res.json();
  }, logoutSession);
  expect(live?.data?.live).toBe(false);

  await page1.close();

  // Tab2 acquires lock and boots; cookie revoked → login.
  await expect(page2.getByRole('heading', { name: 'Вход' })).toBeVisible({ timeout: 15_000 });
  await context.close();
});

test('Ш6-6 / Ю3-6: delayed profile A then login B → only B', async ({ page }) => {
  let releaseProfile!: () => void;
  const held = new Promise<void>((r) => {
    releaseProfile = r;
  });
  let armHold = false;

  await page.route('**/api/me/profile', async (route) => {
    if (armHold) {
      armHold = false;
      await held;
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

  armHold = true;
  await page.getByRole('button', { name: 'Профиль' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Выйти' }).first().click();
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
  await login(page, '+7 900 000-00-00', 'CodeB');
  await expect(page.getByText('Козлов Козьма Козьмич')).toBeVisible();

  releaseProfile();
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

test('Ш6-7: two tabs open simultaneously — one owner, one waiting', async ({ browser }) => {
  const { context, page1, page2 } = await twoPages(browser);
  await Promise.all([page1.goto('/'), page2.goto('/')]);

  const h1Waiting = waitingMessage(page1);
  const h2Waiting = waitingMessage(page2);
  const h1Login = page1.getByRole('heading', { name: 'Вход' });
  const h2Login = page2.getByRole('heading', { name: 'Вход' });

  await expect
    .poll(async () => {
      const w1 = await h1Waiting.isVisible().catch(() => false);
      const w2 = await h2Waiting.isVisible().catch(() => false);
      const l1 = await h1Login.isVisible().catch(() => false);
      const l2 = await h2Login.isVisible().catch(() => false);
      const owners = (l1 ? 1 : 0) + (l2 ? 1 : 0);
      const waiting = (w1 ? 1 : 0) + (w2 ? 1 : 0);
      return owners === 1 && waiting === 1;
    })
    .toBe(true);

  await context.close();
});
