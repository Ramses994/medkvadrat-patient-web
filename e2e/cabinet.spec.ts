import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, phone = '+7 900 000-00-00', code = '123456') {
  // After an in-app logout the login screen is already open — avoid goto('/') which
  // would quiet-refresh a cookie that the aborted logout may not have cleared yet.
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

test('delayed refresh from session A is discarded after login B', async ({ page }) => {
  let releaseRefresh!: () => void;
  const refreshHeld = new Promise<void>((r) => {
    releaseRefresh = r;
  });
  let armHeldRefresh = false;
  const meTokens: string[] = [];

  await page.route('**/api/auth/refresh', async (route) => {
    if (armHeldRefresh) {
      armHeldRefresh = false;
      await refreshHeld;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'Set-Cookie': 'lk_refresh=stale-A; Path=/api/auth; HttpOnly; SameSite=Strict',
        },
        body: JSON.stringify({
          success: true,
          data: { access: 'access-stale-A', access_expires_in: 900 },
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.route('**/api/me/**', async (route) => {
    const auth = route.request().headers()['authorization'] || '';
    meTokens.push(auth);
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
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();

  // First profile request → 401 so the client starts shared refresh (held).
  let profile401Done = false;
  await page.route('**/api/me/profile', async (route) => {
    if (!profile401Done) {
      profile401Done = true;
      armHeldRefresh = true;
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

  await login(page, '+7 900 000-00-00', 'PilotCode2026Demo');
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
  await expect(page.getByText('Петров Пётр Петрович')).toBeVisible();

  releaseRefresh();
  await page.waitForTimeout(800);

  await expect(page.getByText('Доктор Сессия А')).toHaveCount(0);
  await expect(page.getByText('Пациент Сессия А')).toHaveCount(0);
  await expect(page.getByText('Петров Пётр Петрович')).toBeVisible();
  expect(meTokens.some((t) => t.includes('access-stale-A'))).toBe(false);
});

test('delayed profile from session A is discarded after login B', async ({ page }) => {
  let releaseProfile!: () => void;
  const profileHeld = new Promise<void>((r) => {
    releaseProfile = r;
  });
  let holdFirst = true;

  await page.route('**/api/me/profile', async (route) => {
    if (holdFirst) {
      holdFirst = false;
      await profileHeld;
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
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          patient_id: 900001,
          full_name: 'Иванов Иван Иванович',
          phone: '+79000000000',
          email: 'ivan@example.test',
          birth_date: '1990-05-15',
        },
      }),
    });
  });

  await login(page);
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
  await page.getByRole('button', { name: 'Профиль' }).click();
  // Profile A is held; leave and re-login as B.
  await page.getByRole('button', { name: 'Выйти' }).first().click();
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
  await login(page, '+7 900 000-00-00', 'PilotCode2026Demo');
  await expect(page.getByRole('heading', { name: 'Мои записи' })).toBeVisible();
  await page.getByRole('button', { name: 'Профиль' }).click();
  await expect(page.getByText('Иванов Иван Иванович')).toBeVisible();

  releaseProfile();
  await page.waitForTimeout(800);
  await expect(page.getByText('Пациент Сессия А')).toHaveCount(0);
  await expect(page.getByText('Иванов Иван Иванович')).toBeVisible();
});

test('hanging logout clears patient data immediately and unlocks login after 5s', async ({
  page,
}) => {
  await page.route('**/api/auth/logout', async (route) => {
    await new Promise((r) => setTimeout(r, 15_000));
    await route.fulfill({ status: 204 });
  });

  await login(page);
  await expect(page.getByText('Петров Пётр Петрович')).toBeVisible();
  await page.getByRole('button', { name: 'Выйти' }).first().click();
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible({ timeout: 2000 });
  await expect(page.getByText('Петров Пётр Петрович')).toHaveCount(0);

  await page.waitForTimeout(5100);
  await page.getByLabel('Телефон').fill('');
  await page.getByLabel('Телефон').fill('+7 900 000-00-00');
  await page.getByRole('button', { name: 'Получить код' }).click();
  await expect(page.getByLabel('Код')).toBeVisible();
});

test('quiet refresh 401 shows login', async ({ page }) => {
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
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
});
