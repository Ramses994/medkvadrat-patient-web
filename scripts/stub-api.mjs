#!/usr/bin/env node
/**
 * Local / Playwright stub for patient-api (read-only cabinet).
 * Fictional data only: +7 900 000-00-00 / 00-01 / 00-02, example.test.
 */
import http from 'node:http';

const PORT = Number(process.env.STUB_API_PORT || 8091);

/** @type {Map<string, { phone: string, kind: 'A' | 'B' | 'multi' }>} */
const otp = new Map();
/** @type {Map<string, { access: string, sid: string, patient: 'A' | 'B' }>} */
const refreshByToken = new Map();
/** @type {Map<string, 'A' | 'B'>} */
const accessPatient = new Map();
let accessSeq = 1;
let refreshSeq = 1;
let sidSeq = 1;

const PROFILE_A = {
  patient_id: 900001,
  full_name: 'Иванов Иван Иванович',
  phone: '+79000000000',
  email: 'ivan@example.test',
  birth_date: '1990-05-15',
};

const PROFILE_B = {
  patient_id: 900002,
  full_name: 'Иванова Мария Ивановна',
  phone: '+79000000001',
  email: 'maria@example.test',
  birth_date: '1992-08-20',
};

const APPTS_A = [
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

const APPTS_B = [
  {
    planning_id: 800002,
    starts_at: '2099-07-01 10:00',
    duration_min: 20,
    state: 'scheduled',
    is_waitlist: false,
    branch: { id: 10, name: 'Филиал Тестовый', address: 'г. Пример, ул. Примерная, 1' },
    doctor: { id: 22, name: 'Козлов Козьма Козьмич' },
    exam_name: 'Осмотр B',
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

function issueTokens(res, web, patient) {
  const access = `access-${accessSeq++}-${patient}`;
  const refresh = `refresh-${refreshSeq++}`;
  const sid = `sid-${sidSeq++}`;
  refreshByToken.set(refresh, { access, sid, patient });
  accessPatient.set(access, patient);
  if (web) {
    res.setHeader(
      'Set-Cookie',
      `lk_refresh=${refresh}; Path=/api/auth; HttpOnly; SameSite=Strict`,
    );
    return { access, access_expires_in: 900, session: sid };
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

function phoneKind(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.endsWith('00000001')) return 'multi';
  if (digits.endsWith('00000002')) return 'B';
  return 'A';
}

function revokeSid(sid) {
  for (const [tok, meta] of [...refreshByToken.entries()]) {
    if (meta.sid === sid) refreshByToken.delete(tok);
  }
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
      otp.set(id, { phone, kind: phoneKind(phone) });
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
      if (code !== '123456' && code !== 'PilotCode2026Demo' && code !== 'CodeB') {
        return fail(res, 401, 'OTP_INVALID', 'Неверный код');
      }
      if (row.kind === 'multi') {
        return ok(res, {
          patient_candidates: [
            { patient_id: PROFILE_A.patient_id, full_name: PROFILE_A.full_name, masked_email: 'i***@example.test' },
            { patient_id: PROFILE_B.patient_id, full_name: PROFILE_B.full_name, masked_email: 'm***@example.test' },
          ],
        });
      }
      const web = isWeb(req);
      const prev = web ? cookieRefresh(req) : '';
      if (prev && refreshByToken.has(prev)) {
        revokeSid(refreshByToken.get(prev).sid);
      }
      let patient = row.kind === 'B' ? 'B' : 'A';
      if (code === 'CodeB') patient = 'B';
      return ok(res, issueTokens(res, web, patient));
    }

    if (method === 'POST' && path === '/api/auth/otp/select-patient') {
      const body = await readBody(req);
      if (!otp.has(String(body.request_id || ''))) {
        return fail(res, 401, 'OTP_INVALID', 'Неверный код');
      }
      const web = isWeb(req);
      const prev = web ? cookieRefresh(req) : '';
      if (prev && refreshByToken.has(prev)) {
        revokeSid(refreshByToken.get(prev).sid);
      }
      const patient = Number(body.patient_id) === PROFILE_B.patient_id ? 'B' : 'A';
      return ok(res, issueTokens(res, web, patient));
    }

    if (method === 'POST' && path === '/api/auth/refresh') {
      const web = isWeb(req);
      const body = await readBody(req);
      const token = web ? cookieRefresh(req) : String(body.refresh || '');
      if (!token || !refreshByToken.has(token)) {
        if (web) {
          res.setHeader('Set-Cookie', 'lk_refresh=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Strict');
        }
        return fail(res, 401, 'UNAUTHORIZED', 'Unauthorized');
      }
      const meta = refreshByToken.get(token);
      const expected = String(body.session || '');
      if (expected && expected !== meta.sid) {
        return fail(res, 409, 'SESSION_CHANGED', 'Сессия изменилась');
      }
      refreshByToken.delete(token);
      return ok(res, issueTokens(res, web, meta.patient));
    }

    if (method === 'POST' && path === '/api/auth/logout') {
      const web = isWeb(req);
      const body = await readBody(req);
      const token = web ? cookieRefresh(req) : String(body.refresh || '');
      const expected = String(body.session || '');
      let clear = true;
      if (token && refreshByToken.has(token)) {
        const meta = refreshByToken.get(token);
        if (expected && expected !== meta.sid) {
          clear = false;
        } else {
          revokeSid(meta.sid);
        }
      }
      if (web && clear) {
        res.setHeader('Set-Cookie', 'lk_refresh=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Strict');
      }
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      return res.end();
    }

    if (path.startsWith('/api/me/')) {
      const token = bearer(req);
      if (!token) return fail(res, 401, 'UNAUTHORIZED', 'Unauthorized');
      if (token === 'access-expired' || token.endsWith('-expired')) {
        return fail(res, 401, 'UNAUTHORIZED', 'Unauthorized');
      }
      const label = accessPatient.get(token) || 'A';
      const profile = label === 'B' ? PROFILE_B : PROFILE_A;
      const appts = label === 'B' ? APPTS_B : APPTS_A;
      if (method === 'GET' && path === '/api/me/profile') return ok(res, profile);
      if (method === 'GET' && path === '/api/me/appointments') return ok(res, appts);
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
