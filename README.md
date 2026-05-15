# NOTMID — Panel (lista de corte + tareas + hub móvil)

App **Vite + React + TypeScript** con Supabase, pensada para **celular** (layout estrecho y safe-area).

## Rutas

| Ruta | Descripción |
|------|-------------|
| `/` | Hub: accesos a módulos (requiere sesión si Supabase está configurado) |
| `/entrar` | Login email + contraseña (Supabase Auth) |
| `/tareas` | Tareas de empresa (formulario, imágenes, importancia, hecho) |
| `/creador` | Pegar reporte y subir lista de corte |
| `/manejador` | Ver lista por día |

## Base de datos (Supabase)

1. Si aún no corriste el esquema de producción: `sql/nm_prod_schema.sql`  
2. Nuevo hub de tareas + bucket de imágenes: `sql/nm_hub_schema.sql`  
3. **Opcional** (si la tabla `nm_hub_tasks` ya existía sin columna): asignar tareas a usuario → `sql/nm_hub_tasks_assignee.sql`  
4. Perfil por usuario (nombre + rol, trigger al crear usuario en Auth): `sql/nm_hub_profiles.sql`  
5. **Importante:** restricciones por rol en listas de corte y tareas hub: `sql/nm_workshop_roles_rls.sql`  
6. **Opcional** (cuando todo el equipo use login): quitá acceso `anon` a lista de corte con `sql/nm_prod_tighten_authenticated_only.sql`

En **Authentication → Users** creá cuentas para el taller. Desactivá el registro público si no querés que nadie se auto-invite. Cada usuario nuevo recibe fila en `nm_hub_profiles` (rol por defecto `taller_1`). Asigná roles en **Table Editor** → `nm_hub_profiles` → columna `role`: `creador_lista` (solo sube listas de producción), `taller_1` (taller completo salvo subir esa lista), `taller_2` (solo lectura lista + tareas).

Para **sesiones que duren muchos meses**, configurá JWT / refresh en **Authentication → Sessions** según la documentación actual de Supabase (los valores exactos cambian entre versiones del dashboard).

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

### Rutas SPA

El archivo `vercel.json` reescribe las rutas al `index.html` para que al recargar o abrir un enlace directo no dé 404. Los archivos en `dist/assets/` siguen sirviéndose con normalidad.

### Dominio y Supabase

- Agregá la URL de producción en **Authentication → URL Configuration** si usás Auth.
- Las imágenes de tareas van al bucket privado `nm-hub-task-images` (políticas en `nm_hub_schema.sql`).

## Estructura útil

- `src/App.tsx` — rutas y protección de sesión
- `src/components/HubHome.tsx`, `HubTasksApp.tsx`, `LoginPage.tsx`
- `src/lib/useAuth.ts` — sesión + perfil `nm_hub_profiles`
- `src/lib/hubRoles.ts` — permisos por rol en el hub
- `src/lib/hubTasksApi.ts` — API de tareas + Storage
- `sql/nm_hub_tasks_assignee.sql` — columna `assigned_to` en tareas hub (si la tabla ya existía)
- `sql/nm_hub_profiles.sql` — nombre y rol por usuario  
- `sql/nm_workshop_roles_rls.sql` — RLS listas + tareas hub según rol
- `vercel.json` — rewrite SPA para producción
- `.env.example` — plantilla de variables (sin secretos)
