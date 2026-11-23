# Backend de Ferretería A&M

Backend mínimo **sin dependencias externas** (solo Node.js 18+). Proporciona:

- `POST /api/auth/register` — crea el usuario, guarda la contraseña hasheada y envía el correo de confirmación con Brevo.
- `POST /api/auth/login` — verifica la contraseña y crea una cookie de sesión firmada (HttpOnly).
- `GET /api/auth/me` — devuelve el usuario si hay sesión activa.
- `POST /api/auth/logout` — cierra la sesión.
- `GET /api/health` — comprobación rápida de que el servicio responde.

Además, sirve los HTML que están en la raíz del repositorio, así que puedes probar todo desde `http://localhost:3000`.

## 1. Probarlo en tu PC

1. Instala Node.js 18 o superior (es un instalador normal, no es pesado).
2. En esta carpeta, copia `.env.example` a `.env`:
   ```
   copy .env.example .env
   ```
   (En macOS/Linux: `cp .env.example .env`)
3. Edita `.env` y cambia al menos `SESSION_SECRET` por una cadena larga y aleatoria.
4. Arranca el servidor:
   ```
   npm start
   ```
5. Abre <http://localhost:3000> en el navegador. El registro y el login ya funcionan.

Los usuarios se guardan en `server/data/users.json` (ignorado por git). Contraseñas: `scrypt` con sal. Sesiones: cookie firmada con HMAC-SHA256.

> Para desarrollo con recarga automática: `npm run dev`.

## 2. Conectar Brevo

1. En Brevo, verifica un **remitente** (Sender) con tu correo.
2. Crea una **API key** con permisos de envío de correo (SMTP/Transactional).
3. Ponla en `server/.env`:
   ```
   BREVO_API_KEY=tu-api-key-aqui
   BREVO_SENDER_EMAIL=correo-verificado@tudominio.com
   BREVO_SENDER_NAME=Ferretería A&M
   ```
4. Reinicia el servidor. El correo de confirmación se enviará desde el **servidor**; la key nunca aparece en el HTML.

Si `BREVO_API_KEY` está vacía, el registro sigue funcionando y en la consola aparece un aviso de que no se envió el correo.

## 3. Desplegar (cuando quieras dejar de depender de tu PC)

Las instrucciones completas para **Render y Railway** están en [`DEPLOY.md`](../DEPLOY.md) (raíz del repo).
El repo incluye `render.yaml` (Blueprint) y `railway.json` con el health check `/api/health`.

Resumen: build `npm install`, start `npm start`, `NODE_ENV=production` y las variables de Brevo
como secretos de la plataforma. Si el HTML queda en GitHub Pages, pon `ALLOWED_ORIGIN`
con ese origen y `window.API_BASE` en `config.js` con la URL del backend.

Con `API_BASE` vacío, el frontend usa el mismo origen (ideal para `localhost`).

> También puedes arrancar desde la raíz del repo con `npm start` ( usa `server/server.js`).

## Notas

El almacenamiento en JSON y las cookies firmadas sin estado son suficientes para un proyecto pequeño. Para un sitio con muchos usuarios conviene migrar a una base de datos y a un almacén de sesiones con revocación.
