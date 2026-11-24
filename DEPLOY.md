# Despliegue del backend (Render / Railway)

El repo ya trae todo lo necesario: `package.json` en la raíz, `render.yaml`, `railway.json` y el endpoint de salud `/api/health`.

No puedo crear el servicio desde aquí porque no tengo acceso a tu cuenta de Render/Railway. Necesitas conectar tu GitHub y seguir estos pasos. **No pegues la API key de Brevo en el repo.**

## Antes de empezar

- Ten a mano tu **API key de Brevo** (con permisos de envío SMTP) y un **remitente verificado** en Brevo.
- El frontend se sirve desde GitHub Pages y/o Cloudflare Workers, así que el backend debe permitir esos orígenes (separados por comas):
  `https://joaqalmonacid-star.github.io,https://ferreteria-a-m.joaq-almonacid.workers.dev`

---

## Opción A: Render (recomendado, más automático)

1. Entra a <https://dashboard.render.com> → **New → Blueprint**.
2. Conecta el repo `joaqalmonacid-star/Ferreteria-A-M`, rama `main`.
3. Render detectará `render.yaml` automáticamente. Te pedirá los valores de
   `BREVO_API_KEY` y `BREVO_SENDER_EMAIL`: introdúcelos ahí (en el dashboard, nunca en Git).
4. Pulsa **Apply / Create Blueprint** y espera a que el servicio esté **Live**.
5. Copia la URL que te asigne Render, por ejemplo `https://ferreteria-am-backend.onrender.com`.
6. Comprueba que responde: abre `https://TU-URL/api/health` y debe mostrar `{"ok":true,...}`.
7. Edita `config.js` en la raíz del repo:

   ```js
   window.API_BASE = 'https://TU-URL';
   ```

   Haz commit y push. GitHub Pages se actualizará solo.
8. Prueba el registro y el login desde `https://joaqalmonacid-star.github.io`.

> El plan **free** se duerme después de ~15 min de inactividad: la primera petición puede tardar cerca de un minuto. Además, `server/data/users.json` es efímero (se pierde al reiniciar o redesplegar). Para un sitio real conviene una base de datos o un disco persistente.

---

## Opción B: Railway

1. En <https://railway.com> → **New Project → Deploy from GitHub repo** → elige este repo.
2. En los ajustes del servicio:
   - **Root Directory:** raíz del repo (vacío).
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Healthcheck Path:** `/api/health`
3. En la pestaña **Variables** añade:

   | Variable | Valor |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `SESSION_SECRET` | cadena larga y aleatoria |
   | `ALLOWED_ORIGIN` | `https://joaqalmonacid-star.github.io,https://ferreteria-a-m.joaq-almonacid.workers.dev` |
   | `BREVO_API_KEY` | tu API key de Brevo |
   | `BREVO_SENDER_EMAIL` | remitente verificado |
   | `BREVO_SENDER_NAME` | `Ferretería A&M` |

4. En **Settings → Networking** genera un dominio público y cópialo.
5. Sigue los pasos 6, 7 y 8 de Render (health check, `config.js` y prueba).

> `railway.json` está incluido como referencia, pero Railway ha deprecado *Config as Code* para servicios nuevos; los ajustes del dashboard son los que mandan.

---

## Si prefieres servir todo desde Render/Railway

El backend también sirve los HTML de la raíz del repo. Si usas esa URL como sitio principal:

- Deja `ALLOWED_ORIGIN` vacío (mismo origen).
- Deja `window.API_BASE = '';` en `config.js`.

Así no hay CORS entre dominios.
