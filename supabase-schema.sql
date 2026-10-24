-- =====================================================================
--  APUNTES COMPARTIDOS — Esquema de base de datos y seguridad
--  Dónde ejecutarlo: Supabase > SQL Editor > New query > pegar todo > Run
--  Se puede volver a ejecutar sin perder datos (es idempotente).
--
--  Contenido:
--    1. Perfiles (lista blanca de integrantes autorizados)
--    2. Función es_miembro()
--    3. Categorías (asignaturas o temas)
--    4. Documentos (solo metadatos, nunca el archivo)
--    5. Búsqueda en la biblioteca
--    6. Bucket privado y políticas de Storage
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. PERFILES
--    Relaciona el usuario de autenticación con su nombre visible.
--    Estar en esta tabla es lo que AUTORIZA a usar la aplicación:
--    una cuenta de Supabase sin perfil no puede ver ni subir nada.
--    Solo se administra desde el panel/SQL Editor (no desde la app).
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;


-- ---------------------------------------------------------------------
-- 2. ¿EL USUARIO DE LA SESIÓN ES INTEGRANTE AUTORIZADO?
--    SECURITY DEFINER permite consultar profiles sin chocar con su
--    propia política RLS. search_path vacío evita suplantaciones.
-- ---------------------------------------------------------------------
create or replace function public.es_miembro()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p where p.id = (select auth.uid())
  );
$$;

revoke all on function public.es_miembro() from public, anon;
grant execute on function public.es_miembro() to authenticated;

drop policy if exists profiles_select_miembros on public.profiles;
create policy profiles_select_miembros on public.profiles
  for select to authenticated
  using (public.es_miembro());
-- Sin políticas de insert/update/delete: imposible modificar desde la app.


-- ---------------------------------------------------------------------
-- 3. CATEGORÍAS (asignaturas o temas)
--    Se administran desde el SQL Editor. Ver ejemplo al final.
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  name       text primary key check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);

alter table public.categories enable row level security;

drop policy if exists categories_select_miembros on public.categories;
create policy categories_select_miembros on public.categories
  for select to authenticated
  using (public.es_miembro());


-- ---------------------------------------------------------------------
-- 4. DOCUMENTOS (metadatos; el archivo vive en Storage)
-- ---------------------------------------------------------------------
create table if not exists public.documents (
  id                uuid primary key default gen_random_uuid(),
  title             text not null check (char_length(btrim(title)) between 1 and 150),
  description       text check (description is null or char_length(description) <= 1000),
  category          text not null references public.categories (name)
                         on update cascade on delete restrict,
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  storage_path      text not null unique,
  mime_type         text not null check (mime_type in (
                        'application/pdf',
                        'application/msword',
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        'image/jpeg',
                        'image/png')),
  size_bytes        bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  owner_id          uuid not null default auth.uid()
                         references public.profiles (id) on delete restrict,
  created_at        timestamptz not null default now(),
  class_date        date,
  -- La ruta del archivo debe estar dentro de la carpeta del autor.
  constraint documents_path_del_autor
    check (storage_path like owner_id::text || '/%')
);

-- Índices para ordenar por fecha y filtrar por autor/categoría.
create index if not exists documents_created_at_idx     on public.documents (created_at desc);
create index if not exists documents_owner_created_idx  on public.documents (owner_id, created_at desc);
create index if not exists documents_category_created_idx on public.documents (category, created_at desc);

-- El servidor fija autor y fecha de carga: el navegador no puede falsearlos.
create or replace function public.documents_fijar_autor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.owner_id := auth.uid();
  end if;
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists documents_fijar_autor on public.documents;
create trigger documents_fijar_autor
  before insert on public.documents
  for each row execute function public.documents_fijar_autor();

alter table public.documents enable row level security;

drop policy if exists documents_select_miembros on public.documents;
create policy documents_select_miembros on public.documents
  for select to authenticated
  using (public.es_miembro());

drop policy if exists documents_insert_propio on public.documents;
create policy documents_insert_propio on public.documents
  for insert to authenticated
  with check (
    public.es_miembro()
    and owner_id = (select auth.uid())
    and storage_path like (select auth.uid())::text || '/%'
  );

drop policy if exists documents_delete_propio on public.documents;
create policy documents_delete_propio on public.documents
  for delete to authenticated
  using (public.es_miembro() and owner_id = (select auth.uid()));
-- Sin política de UPDATE: los metadatos no se editan en el MVP.

-- Defensa adicional: el rol anónimo no tiene ningún permiso.
revoke all on public.profiles, public.categories, public.documents from anon;


-- ---------------------------------------------------------------------
-- 5. BÚSQUEDA EN LA BIBLIOTECA
--    SECURITY INVOKER: se ejecuta con los permisos del usuario, por lo
--    que las políticas RLS de "documents" siguen aplicándose.
-- ---------------------------------------------------------------------
create or replace function public.search_documents(
  p_query     text    default null,
  p_owner     uuid    default null,
  p_category  text    default null,
  p_ascending boolean default false,
  p_limit     integer default 200
)
returns setof public.documents
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    -- Escapa los comodines para que % y _ se busquen literalmente.
    select '%' || replace(replace(replace(btrim(coalesce(p_query, '')),
             '\', '\\'), '%', '\%'), '_', '\_') || '%' as patron
  )
  select d.*
  from public.documents d, q
  where (coalesce(btrim(p_query), '') = ''
         or d.title ilike q.patron
         or coalesce(d.description, '') ilike q.patron)
    and (p_owner is null or d.owner_id = p_owner)
    and (p_category is null or d.category = p_category)
  order by
    case when p_ascending then d.created_at end asc,
    case when not p_ascending then d.created_at end desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

revoke all on function public.search_documents(text, uuid, text, boolean, integer) from public, anon;
grant execute on function public.search_documents(text, uuid, text, boolean, integer) to authenticated;


-- ---------------------------------------------------------------------
-- 6. ALMACENAMIENTO PRIVADO
--    Bucket NO público, con límite de tamaño y tipos admitidos.
--    Ruta obligatoria de cada archivo: <id-del-autor>/<uuid>.<ext>
--    Para cambiar el límite: edita 10485760 (10 MB) y vuelve a ejecutar,
--    y ajusta MAX_FILE_MB en config.js al mismo valor.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents', 'documents', false, 10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png'
  ]
)
on conflict (id) do update set
  public             = false,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists documents_storage_select on storage.objects;
create policy documents_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and public.es_miembro());

drop policy if exists documents_storage_insert on storage.objects;
create policy documents_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and public.es_miembro()
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 1
    and lower(storage.extension(name)) in ('pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png')
  );

drop policy if exists documents_storage_delete on storage.objects;
create policy documents_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and public.es_miembro()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
-- Sin política de UPDATE: no se pueden sobrescribir archivos existentes.


-- =====================================================================
--  CONFIGURACIÓN DE DATOS (ejecutar aparte, después de crear las cuentas)
-- =====================================================================
-- a) Registrar a los tres integrantes (reemplaza correos y nombres):
--
-- insert into public.profiles (id, display_name)
-- select id, 'Nombre Integrante 1' from auth.users where email = 'correo1@ejemplo.com'
-- on conflict (id) do update set display_name = excluded.display_name;
--
-- b) Cargar asignaturas o temas:
--
-- insert into public.categories (name) values
--   ('Asignatura 1'), ('Asignatura 2'), ('General')
-- on conflict do nothing;
