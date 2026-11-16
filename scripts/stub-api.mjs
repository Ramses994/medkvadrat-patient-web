#!/usr/bin/env node
/**
 * Local / Playwright stub for patient-api (read-only cabinet).
 * Fictional data only: +7 900 000-00-00, Иванов Иван Иванович, example.test.
 */
import http from 'node:http';

const PORT = Number(process.env.STUB_API_PORT || 8091);

/** @type {Map<string, { phone: string, multi?: boolean }>} */
const otp = new Map();
/** @type {Map<string, string>} */
const refreshByToken = new Map();
let accessSeq = 1;
let refreshSeq = 1;

const PROFILE = {
  patient_id: 900001,
  full_name: 'Иванов Иван Иванович',
  phone: '+79000000000',
  email: 'ivan@example.test',
  birth_date: '1990-05-15',
};

const PROFILE_B = {
  patient_id: 900002,
  full_name: 'Иванова Мария Ивановна',
  phone: '+79000000000',
  email: 'maria@example.test',
  birth_date: '1992-08-20',
};

const APPTS = [
  {
    planning_id: 800001,
    starts_at: '2099-06-26 19:30',
    duration_min: 30,
    state: 'scheduled',
    is_waitlist: false,
    branch: { id: 10, name: 'Филиал Тестовый', address: 'г. Пример, ул. Примерная, 1' },
    doctor: { id: 20, name: 'Петров Пётр Петрович' },
    exam_name: 'Консультация терапевта',
    confirmation: 'confirmed',
  },
];

const VISITS = [
  {
    planning_id: 800010,
    starts_at: '2025-03-10 11:00',
    duration_min: 20,
    state: 'attended',
    is_waitlist: false,
    branch: { id: 10, name: 'Филиал Тестовый', address: 'г. Пример, ул. Примерная, 1' },
    doctor: { id: 21, name: 'Сидорова Анна Сергеевна' },
    exam_name: 'Осмотр',
    confirmation: null,
  },
];

function json(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(raw);
}

function ok(res, data) {
  json(res, 200, { success: true, data });
}

function fail(res, status, code, message) {
  json(res, status, {
    success: false,
    error: message,
    error_details: { code, message },
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function issueTokens(res, web) {
  const access = `access-${accessSeq++}`;
  const refresh = `refresh-${refreshSeq++}`;
  refreshByToken.set(refresh, access);
  if (web) {
    res.setHeader(
      'Set-Cookie',
      `lk_refresh=${refresh}; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=43200`,
    );
    return { access, access_expires_in: 900 };
  }
  return { access, refresh, access_expires_in: 900, refresh_expires_in: 2592000 };
}

function isWeb(req) {
  return String(req.headers['x-lk-client'] || '').toLowerCase() === 'web';
}

function cookieRefresh(req) {
  const raw = req.headers.cookie || '';
  const m = /(?:^|;\s*)lk_refresh=([^;]+)/.exec(raw);
  return m ? decodeURIComponent(m[1]) : '';
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  const path = url.pathname;
  const method = req.method || 'GET';

  try {
    if (method === 'GET' && path === '/api/health') {
      return ok(res, { status: 'ok' });
    }

    if (method === 'POST' && path === '/api/auth/otp/request') {
      const body = await readBody(req);
      const phone = String(body.phone || '');
      const id = `req-${otp.size + 1}`;
      const multi = phone.includes('9000000001') || phone.includes('900 000-00-01');
      otp.set(id, { phone, multi });
      return ok(res, {
        request_id: id,
        ttl: 300,
        message: 'Если номер зарегистрирован в клинике, код отправлен на e-mail из карточки',
      });
    }

    if (method === 'POST' && path === '/api/auth/otp/verify') {
      const body = await readBody(req);
      const row = otp.get(String(body.request_id || ''));
      const code = String(body.code || '');
      if (!row) return fail(res, 401, 'OTP_INVALID', 'Неверный код');
      if (code !== '123456' && code !== 'PilotCode2026Demo') {
        return fail(res, 401, 'OTP_INVALID', 'Неверный код');
      }
      if (row.multi) {
        return ok(res, {
          patient_candidates: [
            { patient_id: PROFILE.patient_id, full_name: PROFILE.full_name, masked_email: 'i***@example.test' },
            { patient_id: PROFILE_B.patient_id, full_name: PROFILE_B.full_name, masked_email: 'm***@example.test' },
          ],
        });
      }
      return ok(res, issueTokens(res, isWeb(req)));
    }

    if (method === 'POST' && path === '/api/auth/otp/select-patient') {
      const body = await readBody(req);
      if (!otp.has(String(body.request_id || ''))) {
        return fail(res, 401, 'OTP_INVALID', 'Неверный код');
      }
      return ok(res, issueTokens(res, isWeb(req)));
    }

    if (method === 'POST' && path === '/api/auth/refresh') {
      const web = isWeb(req);
      const token = web ? cookieRefresh(req) : String((await readBody(req)).refresh || '');
      if (!token || !refreshByToken.has(token)) {
        if (web) {
          res.setHeader('Set-Cookie', 'lk_refresh=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Strict');
        }
        return fail(res, 401, 'UNAUTHORIZED', 'Unauthorized');
      }
      refreshByToken.delete(token);
      return ok(res, issueTokens(res, web));
    }

    if (method === 'POST' && path === '/api/auth/logout') {
      const web = isWeb(req);
      const token = web ? cookieRefresh(req) : String((await readBody(req)).refresh || '');
      if (token) refreshByToken.delete(token);
      if (web) {
        res.setHeader('Set-Cookie', 'lk_refresh=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Strict');
      }
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      return res.end();
    }

    if (path.startsWith('/api/me/')) {
      const token = bearer(req);
      if (!token) return fail(res, 401, 'UNAUTHORIZED', 'Unauthorized');
      // Simulate expired access once when client asks with access-expired.
      if (token === 'access-expired') {
        return fail(res, 401, 'UNAUTHORIZED', 'Unauthorized');
      }
      if (method === 'GET' && path === '/api/me/profile') return ok(res, PROFILE);
      if (method === 'GET' && path === '/api/me/appointments') return ok(res, APPTS);
      if (method === 'GET' && path === '/api/me/visits') return ok(res, VISITS);
      return fail(res, 404, 'NOT_FOUND', 'Not found');
    }

    fail(res, 404, 'NOT_FOUND', 'Not found');
  } catch {
    fail(res, 400, 'VALIDATION', 'Невалидный JSON');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`stub-api on http://127.0.0.1:${PORT}\n`);
});
