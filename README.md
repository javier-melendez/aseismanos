# A Seis Manos | Almuerzos

Web app sencilla para gestión de fidelización de almuerzos.

## Ejecutar local

Abre `index.html` en el navegador. Si no hay conexión con Supabase, la app funciona en modo demo usando `localStorage`.

## Configuración general

- `supabase-schema.sql` contiene el esquema de base de datos y las funciones necesarias.
- `supabase-config.js` define la URL del proyecto y la llave pública de acceso.
- El admin se autentica en la app para gestionar clientes y saldos.
- El cliente usa su documento de identidad para ver su progreso.

## Publicar

1. Sube el proyecto a GitHub.
2. Publica como sitio estático desde el branch principal.

## Archivo principal

- `index.html`: interfaz de usuario.
- `app.js`: lógica de cliente y admin.
- `styles.css`: estilos.
- `supabase-config.js`: configuración de Supabase.
- `supabase-schema.sql`: estructura de datos y funciones.
