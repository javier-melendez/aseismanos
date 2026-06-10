# A Seis Manos | Almuerzos

Web app sencilla para fidelización de almuerzos: cada 10 almuerzos pagos, el cliente recibe 1 almuerzo gratis.

## Ejecutar local

Abre `index.html` en el navegador. Si no has configurado Supabase, la app corre en modo demo usando `localStorage`.

## Configurar Supabase

1. Crea un proyecto en Supabase.
2. En el SQL editor, ejecuta `supabase-schema.sql`.
3. En `app.js`, reemplaza:
   - `YOUR_PROJECT.supabase.co`
   - `YOUR_SUPABASE_ANON_KEY`
4. Sirve estos archivos como sitio estático.

## Seguridad implementada

- Los códigos son alfanuméricos, de máximo 6 caracteres.
- La piscina de códigos por fecha se limita a 10.000 candidatos.
- Cada código tiene `valid_on`, por lo que solo se puede redimir en la fecha correcta.
- Al redimir se valida también la fecha del cliente contra `current_date` del servidor.
- Los códigos usados quedan bloqueados con `used_at` y `used_by`.
- El admin puede marcar un almuerzo gratis como entregado, descontándolo del saldo del cliente.
- Las tablas sensibles no tienen acceso directo para `anon`; la app usa funciones RPC con `security definer`.

Para producción, cambia la contraseña admin por un secreto real fuera del frontend. La contraseña `admin` sirve solo para esta primera versión solicitada.
