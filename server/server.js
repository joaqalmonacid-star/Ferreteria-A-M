'use strict';

/*
 * Backend ligero para Ferretería A&M.
 * Sin dependencias externas: usa solo módulos incluidos en Node.js 18+.
 * Sirve además los HTML del repositorio para poder probarlo en localhost.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ─── Configuración ────────────────────────────────────────────────────────────
// Carga .env sin dependencias (solo claves KEY=valor, ignora comentarios).
(function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
})();

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSION_SECRET = process.env.SESSION_SECRET || 'cambia-este-valor-por-una-cadena-larga-y-aleatoria';
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || '').trim();
const NODE_ENV = process.env.NODE_ENV || 'development';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 días, en segundos

// ─── Almacenamiento (JSON simple; suficiente para este proyecto) ──────────────
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]', 'utf8');

function readUsers() {
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[datos] No se pudo leer users.json:', error.message);
    return [];
  }
}

function writeUsers(users) {
  const temp = USERS_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(users, null, 2), 'utf8');
  fs.renameSync(temp, USERS_FILE);
}

// ─── Contraseñas y sesiones ───────────────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 2) return false;
  const hash = Buffer.from(parts[1], 'hex');
  const actual = crypto.scryptSync(password, parts[0], 64);
  return hash.length === actual.length && crypto.timingSafeEqual(hash, actual);
}

function signSession(correo) {
  const payload = Buffer.from(JSON.stringify({
    correo: correo,
    exp: Date.now() + SESSION_MAX_AGE * 1000
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return payload + '.' + signature;
}

function readSession(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)ham_session=([^;]+)/);
  if (!match) return null;
  const parts = decodeURIComponent(match[1]).split('.');
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(parts[0]).digest('base64url');
  const given = Buffer.from(parts[1]);
  const real = Buffer.from(expected);
  if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) return null;
  try {
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!data.correo || !data.exp || Date.now() > data.exp) return null;
    return data.correo;
  } catch (error) {
    return null;
  }
}

function sessionCookie(value) {
  // Si el frontend está en otro dominio (GitHub Pages) necesitamos
  // SameSite=None + Secure para que el navegador envíe la cookie en fetch cross-site.
  const crossSite = NODE_ENV === 'production' && Boolean(ALLOWED_ORIGIN);
  const secure = NODE_ENV === 'production' ? '; Secure' : '';
  const sameSite = crossSite ? '; SameSite=None' : '; SameSite=Lax';
  return 'ham_session=' + value + '; Path=/; HttpOnly' + sameSite + '; Max-Age=' +
    (value ? SESSION_MAX_AGE : 0) + secure;
}

function publicUser(user) {
  return {
    nombres: user.nombres,
    apellidos: user.apellidos,
    correo: user.correo,
    celular: user.celular,
    comuna: user.comuna
  };
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, function (char) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
  });
}

// ─── Brevo ────────────────────────────────────────────────────────────────────
async function sendConfirmationEmail(user) {
  const apiKey = (process.env.BREVO_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[brevo] BREVO_API_KEY no configurada: no se envió el correo de confirmación.');
    return;
  }
  const senderEmail = (process.env.BREVO_SENDER_EMAIL || '').trim();
  if (!senderEmail) {
    console.warn('[brevo] BREVO_SENDER_EMAIL no configurada: no se envió el correo.');
    return;
  }

  const senderName = process.env.BREVO_SENDER_NAME || 'Ferretería A&M';
  const htmlContent =
    '<p>Hola ' + escapeHtml(user.nombres) + ':</p>' +
    '<p>Tu cuenta ha sido creada con éxito y serás notificado cuando la página empiece a funcionar.</p>' +
    '<p>Ferretería A&M — Calbuco</p>';
  const textContent = 'Hola ' + user.nombres + ':\n\n' +
    'Tu cuenta ha sido creada con éxito y serás notificado cuando la página empiece a funcionar.\n\n' +
    'Ferretería A&M — Calbuco';

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: [{ email: user.correo, name: user.nombres + ' ' + user.apellidos }],
        subject: 'Tu cuenta en Ferretería A&M ha sido creada',
        htmlContent: htmlContent,
        textContent: textContent
      })
    });
    if (!response.ok) {
      console.error('[brevo] Error al enviar correo:', response.status, await response.text());
    } else {
      console.log('[brevo] Correo de confirmación enviado a ' + user.correo);
    }
  } catch (error) {
    console.error('[brevo] No se pudo conectar con Brevo:', error.message);
  }
}

// ─── Utilidades HTTP ──────────────────────────────────────────────────────────
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    let data = '';
    req.on('data', function (chunk) {
      data += chunk;
      if (data.length > 65536) {
        reject(new Error('Cuerpo demasiado grande'));
        req.destroy();
      }
    });
    req.on('end', function () {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function applyCors(req, res) {
  if (!ALLOWED_ORIGIN) return;
  if (req.headers.origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  let relative = decodeURIComponent(pathname);
  if (relative === '/' || relative === '') relative = '/index.html';
  const filePath = path.resolve(ROOT, '.' + relative);

  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return sendJson(res, 403, { ok: false, error: 'Acceso denegado' });
  }

  fs.stat(filePath, function (error, stat) {
    if (error || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No encontrado');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

// ─── Rutas API ────────────────────────────────────────────────────────────────
const server = http.createServer(async function (req, res) {
  applyCors(req, res);

  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: 'URL inválida' });
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }

  try {
    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, service: 'ferreteria-am-backend' });
    }

    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const body = await readBody(req);
      const nombres = String(body.nombres || '').trim();
      const apellidos = String(body.apellidos || '').trim();
      const correo = String(body.correo || '').trim().toLowerCase();
      const celular = String(body.celular || '').trim();
      const comuna = String(body.comuna || '').trim();
      const password = String(body.password || '');

      if (!nombres || !apellidos || !correo || !celular || !comuna || !password) {
        return sendJson(res, 400, { ok: false, error: 'Completa todos los campos.' });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
        return sendJson(res, 400, { ok: false, error: 'El correo electrónico no es válido.' });
      }
      if (password.length < 6) {
        return sendJson(res, 400, { ok: false, error: 'Mínimo 6 caracteres.' });
      }

      const users = readUsers();
      if (users.some(function (u) { return u.correo.toLowerCase() === correo; })) {
        return sendJson(res, 409, { ok: false, error: 'Ya existe una cuenta con ese correo.' });
      }

      users.push({
        nombres: nombres,
        apellidos: apellidos,
        correo: correo,
        celular: celular,
        comuna: comuna,
        passwordHash: hashPassword(password),
        creadoEn: new Date().toISOString()
      });
      writeUsers(users);

      await sendConfirmationEmail({ nombres: nombres, apellidos: apellidos, correo: correo });
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readBody(req);
      const correo = String(body.correo || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!correo || !password) {
        return sendJson(res, 400, { ok: false, error: 'Completa correo y contraseña.' });
      }

      const user = readUsers().find(function (u) { return u.correo.toLowerCase() === correo; });
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return sendJson(res, 401, { ok: false, error: 'Correo o contraseña incorrectos.' });
      }

      res.setHeader('Set-Cookie', sessionCookie(signSession(user.correo)));
      return sendJson(res, 200, { ok: true, user: publicUser(user) });
    }

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      const correo = readSession(req);
      if (!correo) return sendJson(res, 200, { ok: false });
      const user = readUsers().find(function (u) { return u.correo.toLowerCase() === correo; });
      if (!user) return sendJson(res, 200, { ok: false });
      return sendJson(res, 200, { ok: true, user: publicUser(user) });
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', sessionCookie(''));
      return sendJson(res, 200, { ok: true });
    }
  } catch (error) {
    console.error('[api] Error:', error);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'Error interno del servidor.' });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveStatic(req, res, pathname);
  }
  return sendJson(res, 405, { ok: false, error: 'Método no permitido.' });
});

server.listen(PORT, function () {
  console.log('Ferretería A&M backend escuchando en http://localhost:' + PORT);
  console.log('Sirviendo HTML desde: ' + ROOT);
  if (!process.env.SESSION_SECRET || SESSION_SECRET === 'cambia-este-valor-por-una-cadena-larga-y-aleatoria') {
    console.warn('[seguridad] Configura SESSION_SECRET en server/.env antes de usar en producción.');
  }
});
