# Apuntes Compartidos

Biblioteca web privada de apuntes para tres integrantes. Cualquiera puede subir documentos; los tres pueden buscarlos, verlos y descargarlos desde cualquier dispositivo.

**Tecnología:** HTML, CSS y JavaScript estándar (sin Node.js ni compilación) · Supabase (inicio de sesión, base de datos PostgreSQL y almacenamiento privado) · GitHub Pages (publicación).

---

## 1. Estructura

```
index.html            Estructura de todas las pantallas (acceso, inicio, biblioteca, subir, visor)
styles.css            Diseño y adaptación a celular, tablet y computador
config.js             Datos PÚBLICOS de Supabase y ajustes (límite de tamaño, formatos)
supabase-client.js    Conexión única con Supabase
auth.js               Inicio de sesión, validación y cierre de sesión
documents.js          Subir, buscar, ver, descargar y eliminar apuntes
app.js                Navegación y conexión entre pantallas y datos
supabase-schema.sql   Tablas, índices, políticas RLS y políticas de Storage
supabase-tests.sql    Pruebas automáticas de seguridad (se ejecutan en Supabase)
README.md             Este documento
```

Todos los archivos van en la **raíz** del repositorio.

## 2. Decisiones técnicas (explicadas)

- **Una sola página con secciones.** La navegación cambia de sección sin recargar (`#/inicio`, `#/biblioteca`, `#/subir`). Así funciona bien en GitHub Pages, y el botón "atrás" del navegador también funciona.
- **La seguridad está en el servidor, no en los botones.** Supabase revisa cada operación con *políticas RLS* (Row Level Security: reglas por fila). Aunque alguien modifique la página o llame a la API directamente, la base de datos solo permite lo autorizado.
- **Doble llave de acceso.** Para entrar hay que tener una cuenta en Supabase **y** un perfil en la tabla `profiles`. Una cuenta sin perfil no ve nada.
- **Archivos privados.** El bucket `documents` no es público. Para ver o descargar un archivo se genera un *enlace firmado* que caduca a los 5 minutos. No existen enlaces permanentes.
- **Cada archivo vive en la carpeta de su autor:** `<id-del-autor>/<código-aleatorio>.<ext>`. El nombre original solo se guarda como dato y no forma parte de la ruta.
- **Validación en tres niveles:**
  1. **En el navegador:** extensión, tamaño y "firma" binaria (los primeros bytes reales del archivo). Así se detecta, por ejemplo, un HTML renombrado como `.pdf`.
  2. **En Storage:** tipos MIME permitidos y tamaño máximo.
  3. **En la base de datos:** restricciones sobre el tipo de archivo y la ruta.
- **Carga consistente.** Primero se sube el archivo y después se guardan los datos. Si guardar los datos falla, el archivo se borra automáticamente.
- **Eliminación consistente.** Primero se borran los datos, así el apunte desaparece de la biblioteca. Después se borra el archivo, con hasta 3 reintentos. De este modo nunca queda en la lista un apunte cuyo archivo no existe.
- **Preparado para crecer.** Las categorías están en su propia tabla y la búsqueda es una función SQL. Agregar etiquetas, favoritos, comentarios o un rol de administrador se hace sumando tablas y políticas, sin rehacer lo existente.

## 3. Configuración de Supabase

1. Crea una cuenta en [supabase.com](https://supabase.com) y un proyecto nuevo (plan Free). Guarda la contraseña de la base de datos en un lugar seguro, **no en el repositorio**.
2. **Authentication → Sign In / Providers**:
   - Desactiva **Allow new users to sign up** (bloquea el registro público).
   - Deja activo el proveedor **Email**.
   - Verifica que **Allow anonymous sign-ins** esté desactivado.
3. **SQL Editor → New query**: pega todo `supabase-schema.sql` y presiona **Run**. Debe terminar con "Success".
4. **Authentication → Users → Add user → Create new user**: crea las 3 cuentas con correo y contraseña, marcando **Auto Confirm User**. Usa contraseñas de 12 caracteres o más.
5. **SQL Editor**: registra a los integrantes y las asignaturas, reemplazando los datos de ejemplo:
   ```sql
   insert into public.profiles (id, display_name)
   select id, 'Nombre Apellido 1' from auth.users where email = 'correo1@ejemplo.com';
   insert into public.profiles (id, display_name)
   select id, 'Nombre Apellido 2' from auth.users where email = 'correo2@ejemplo.com';
   insert into public.profiles (id, display_name)
   select id, 'Nombre Apellido 3' from auth.users where email = 'correo3@ejemplo.com';

   insert into public.categories (name) values
     ('Asignatura 1'), ('Asignatura 2'), ('General')
   on conflict do nothing;
   ```
6. **SQL Editor**: ejecuta `supabase-tests.sql`. Todas las filas deben decir **OK** (15 pruebas).
7. **Project Settings → API**: copia **Project URL** y la clave **anon public** en `config.js`.
   ⚠️ **Nunca** copies la clave `service_role`: da acceso total y se salta todas las reglas.

### Cambiar el límite de tamaño (10 MB por defecto)
Cambia `MAX_FILE_MB` en `config.js` **y** `file_size_limit` en `supabase-schema.sql` (en bytes: MB × 1048576). Luego vuelve a ejecutar el SQL. El plan Free de Supabase permite hasta 50 MB por archivo.

### Agregar una asignatura más adelante
```sql
insert into public.categories (name) values ('Nueva asignatura');
```

## 4. Publicación en GitHub Pages

1. En GitHub, crea un repositorio **público** (por ejemplo, `apuntes-compartidos`). En el plan gratuito, GitHub Pages solo funciona con repositorios públicos. Esto no expone los apuntes: el código no contiene contraseñas y los archivos están en Supabase, protegidos.
2. Sube todos los archivos (**Add file → Upload files**) a la rama `main`.
3. **Settings → Pages**: en Source elige **Deploy from a branch**, rama `main`, carpeta `/ (root)`. Espera 1 a 2 minutos.
4. La dirección será `https://<tu-usuario>.github.io/apuntes-compartidos/`.
5. En Supabase, **Authentication → URL Configuration**: escribe esa dirección en **Site URL**.

## 5. Pruebas de aceptación

| # | Prueba | Cómo verificarla |
|---|---|---|
| 1 | Los 3 integrantes inician sesión | Entra con cada cuenta. |
| 2 | Un no autorizado no accede | Crea una 4.ª cuenta en Supabase **sin** perfil e intenta entrar: debe decir "Tu cuenta no tiene acceso". |
| 3 | Cada uno sube un archivo | Sube un PDF, un Word y una imagen. Revisa la fila en **Table Editor → documents**. |
| 4 | Los demás lo ven | Entra con otra cuenta y búscalo en la biblioteca. |
| 5 | Persistencia | Cierra sesión, vuelve a entrar y prueba en otro dispositivo. |
| 6 | Buscar, abrir, descargar | Usa el buscador, los filtros, **Ver** y **Descargar**. |
| 7 | Solo elimina lo propio | El botón de eliminar solo aparece en tus apuntes. La prueba real es la siguiente. |
| 8 | Permisos en la API | Ver "Ataques directos" abajo, y `supabase-tests.sql`. |
| 9 | Computador y celular | Abre la dirección publicada en ambos. |
| 10 | Datos reales | La versión publicada usa tu proyecto de Supabase. |
| 11 | Sin credenciales expuestas | En GitHub, busca en el repositorio `service_role` y tus contraseñas: no deben aparecer. |

### Ataques directos (prueba 8)
Con la sesión iniciada como **integrante A**, abre la consola del navegador (F12 → Consola) y pega:

```js
const { supabase } = await import('./supabase-client.js');

// a) Borrar un documento de otro integrante (copia su id desde Table Editor):
const r1 = await supabase.from('documents').delete().eq('id', 'ID-DE-OTRO').select();
console.log('Filas borradas (debe ser 0):', r1.data?.length);

// b) Subir un archivo a la carpeta de otro integrante:
const r2 = await supabase.storage.from('documents')
  .upload('ID-USUARIO-OTRO/intruso.pdf', new Blob(['%PDF'], { type: 'application/pdf' }));
console.log('Debe dar error:', r2.error?.message);

// c) Borrar el archivo de otro (copia su storage_path):
const r3 = await supabase.storage.from('documents').remove(['RUTA-DE-OTRO']);
console.log('Archivos borrados (debe ser 0):', r3.data?.length);
```

Sin sesión, desde cualquier computador (reemplaza los valores):
```bash
# Debe responder error de permisos o lista vacía, nunca datos
curl "https://TU-PROYECTO.supabase.co/rest/v1/documents?select=*" -H "apikey: TU-ANON-KEY"
# Un enlace público directo debe fallar (el bucket no es público)
curl "https://TU-PROYECTO.supabase.co/storage/v1/object/public/documents/CUALQUIER-RUTA"
```

## 6. Mantenimiento

**Archivos sin registro (raro).** Ocurre si se corta la conexión justo entre borrar los datos y borrar el archivo. Para listarlos:
```sql
select o.name, o.created_at from storage.objects o
where o.bucket_id = 'documents'
  and not exists (select 1 from public.documents d where d.storage_path = o.name);
```
Para borrarlos: **Storage → documents**, abre la carpeta y elimínalos desde allí. No los borres con SQL.

**Agregar un integrante:** créalo en Authentication y agrega su fila en `profiles`.
**Quitar el acceso a alguien:** borra su fila en `profiles`. Si ya no tiene apuntes, también puedes borrar la cuenta en Authentication.

## 7. Límites de los servicios gratuitos

Revisa los valores vigentes en [supabase.com/pricing](https://supabase.com/pricing) antes de depender de ellos.

- **Supabase Free:** 500 MB de base de datos, 1 GB de archivos y 5 GB de transferencia al mes. Permite 2 proyectos gratuitos.
  - ⚠️ **El proyecto se pausa tras una semana sin actividad.** Se reactiva desde el panel, pero mientras tanto la app no funciona. Considéralo en vacaciones o en semanas sin uso.
- **Qué generaría costos:** superar 1 GB de archivos (aproximadamente 100 PDF de 10 MB, o muchos más si son livianos) o la transferencia mensual obliga a pasar al plan Pro de Supabase, que es de pago.
- **GitHub Pages:** gratis con repositorio público. Publicar desde un repositorio privado requiere un plan de pago de GitHub.

## 8. Limitaciones conocidas

- **PDF en celulares.** Muchos celulares no muestran PDF dentro de la página. Por eso el visor incluye el botón **Abrir**, que lo abre en una pestaña nueva.
- **Formato del selector de fecha.** Depende del idioma configurado en el dispositivo. En la biblioteca, las fechas siempre se muestran como dd-mm-aaaa.
- **Encabezados de seguridad.** GitHub Pages no permite configurarlos. Por eso la política de seguridad (CSP) va dentro de `index.html`.
- **Almacenamiento de la sesión.** El token se guarda en el navegador, que es el método estándar de Supabase. La CSP y el hecho de mostrar todo texto como texto plano (sin interpretarlo como HTML) reducen el riesgo de robo.
