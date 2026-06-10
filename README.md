# A Seis Manos | Almuerzos

Web app sencilla para fidelización de almuerzos: cada 10 almuerzos pagos, el cliente recibe 1 almuerzo gratis.

## Ejecutar local

Abre `index.html` en el navegador. Si no has configurado Supabase, la app corre en modo demo usando `localStorage`.

## Configurar Supabase

1. Crea un proyecto en Supabase.
2. En el SQL editor, ejecuta `supabase-schema.sql`.
3. En Authentication > Users, crea el usuario admin.
4. En el SQL Editor, registra ese usuario como admin:

   ```sql
   insert into public.app_admins (user_id, email)
   select id, email
   from auth.users
   where email = 'admin@restaurante.com'
   on conflict (user_id) do update
   set email = excluded.email;
   ```

La app ahora funciona sin códigos para el cliente: el admin asigna los almuerzos a cada cuenta por cédula y el cliente solo consulta su saldo.

   Si Supabase tiene confirmación de email activa, confirma ese usuario antes de probar el login.

5. En `supabase-config.js`, reemplaza:
   - `YOUR_PROJECT.supabase.co`
   - `YOUR_SUPABASE_ANON_KEY`
6. Sirve estos archivos como sitio estático.

## Publicar en GitHub Pages

1. Sube el proyecto a GitHub.
2. En el repositorio, entra a Settings > Pages.
3. En Source, selecciona Deploy from a branch.
4. Elige branch `main` y folder `/root`.
5. Guarda y espera la URL pública de GitHub Pages.

La `anon public key` de Supabase puede estar en `supabase-config.js`; está diseñada para usarse desde el navegador. No pongas nunca la `service_role key` en GitHub.

## Seguridad implementada

- El admin puede asignar almuerzos pagos directamente al cliente.
- Cuando el cliente completa 10 almuerzos pagos, obtiene un almuerzo gratis automáticamente.
- El admin puede marcar un almuerzo gratis como entregado, descontándolo del saldo del cliente.
- El admin usa Supabase Auth y debe estar registrado en `public.app_admins`.
- Las tablas sensibles no tienen acceso directo para `anon`; la app usa funciones RPC con `security definer`.
