# NOTMID — Lista de corte

App **Vite + React + TypeScript** con Supabase. Rutas por pathname: `/`, `/creador`, `/manejador`.

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `VITE_SUPABASE_URL` | URL del proyecto (Settings → API en Supabase) |
| `VITE_SUPABASE_ANON_KEY` | Clave `anon` `public` (Settings → API) |

En local: copiá `.env.example` a `.env` y completá los valores.

## Scripts

- `npm install` — dependencias  
- `npm run dev` — desarrollo  
- `npm run build` — compilación de producción (`dist/`)  
- `npm run preview` — previsualizar el build localmente  
- `npm test` — pruebas del parser de reportes (`parseReport`)  

## Deploy en Vercel

1. **Subí el código a Git** (GitHub, GitLab o Bitbucket) si aún no está en un repo remoto.
2. Entrá en [vercel.com](https://vercel.com), iniciá sesión y **Add New → Project**.
3. **Importá el repositorio** del proyecto y dejá que Vercel detecte **Vite** (o elegí “Vite” como framework).
4. **Build & Output** (por defecto suele ser correcto):
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`
5. En **Environment Variables**, agregá **las mismas** que en `.env` (Production y, si querés, Preview):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
6. **Deploy**. Cada push a la rama conectada generará un nuevo deploy.

### Rutas (`/creador`, `/manejador`)

El archivo `vercel.json` reescribe las rutas al `index.html` para que al recargar o abrir un enlace directo no dé 404. Los archivos en `dist/assets/` siguen sirviéndose con normalidad.

### Dominio y Supabase

- Si usás **Auth** u OAuth en Supabase, agregá la URL de Vercel (p. ej. `https://tu-app.vercel.app`) en **Authentication → URL Configuration** según la doc de Supabase.
- Para solo datos con la clave `anon` desde el front, con las variables bien configuradas suele alcanzar.

## Estructura útil

- `src/App.tsx` — rutas por `window.location.pathname`
- `vercel.json` — rewrite SPA para producción
- `.env.example` — plantilla de variables (sin secretos)
