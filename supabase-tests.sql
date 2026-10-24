-- =====================================================================
--  APUNTES COMPARTIDOS — Pruebas automáticas de seguridad (RLS)
--  Dónde ejecutarlo: Supabase > SQL Editor, DESPUÉS de supabase-schema.sql
--  y de registrar al menos 2 perfiles y 1 categoría.
--
--  Simula peticiones de: visitante anónimo, cuenta NO autorizada,
--  integrante A e integrante B. Todo ocurre dentro de una transacción
--  Los datos de prueba se eliminan al final: no queda nada guardado.
--  Resultado esperado: todas las filas con resultado = 'OK'.
-- =====================================================================
drop table if exists pg_temp.resultados;
create temp table resultados (n serial, prueba text, resultado text, detalle text);
grant all on resultados to anon, authenticated;
grant usage on sequence resultados_n_seq to anon, authenticated;

do $$
declare
  a uuid; b uuid; x uuid := gen_random_uuid();
  cat text; doc_b uuid; doc_a uuid; n int; dueno uuid; fecha timestamptz;

begin
  select id into a from public.profiles order by created_at, id limit 1;
  select id into b from public.profiles where id <> a order by created_at, id limit 1;
  select name into cat from public.categories limit 1;
  if a is null or b is null or cat is null then
    raise exception 'Faltan datos: se necesitan 2 perfiles y 1 categoría.';
  end if;

  -- Documento de prueba de B, creado como administrador.
  insert into public.documents (title, description, category, original_filename,
                                storage_path, mime_type, size_bytes, owner_id)
  values ('ZZ prueba de B', 'texto buscable', cat, 'b.pdf',
          b::text || '/prueba-b.pdf', 'application/pdf', 100, b)
  returning id into doc_b;

  -- 1. Visitante anónimo no puede leer documentos
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    select count(*) into n from public.documents;
    insert into resultados (prueba, resultado, detalle)
      values ('Anónimo no ve documentos', case when n = 0 then 'OK' else 'FALLA' end, n || ' filas');
  exception when insufficient_privilege then
    insert into resultados (prueba, resultado, detalle)
      values ('Anónimo no ve documentos', 'OK', 'permiso denegado');
  end;
  perform set_config('role', 'postgres', true);

  -- 2. Cuenta autenticada pero NO autorizada
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into n from public.documents;
  insert into resultados (prueba, resultado, detalle)
    values ('No autorizado no ve documentos', case when n = 0 then 'OK' else 'FALLA' end, n || ' filas');
  select count(*) into n from public.profiles;
  insert into resultados (prueba, resultado, detalle)
    values ('No autorizado no ve perfiles', case when n = 0 then 'OK' else 'FALLA' end, n || ' filas');
  begin
    insert into public.documents (title, category, original_filename, storage_path, mime_type, size_bytes)
    values ('intruso', cat, 'x.pdf', x::text || '/x.pdf', 'application/pdf', 10);
    insert into resultados (prueba, resultado) values ('No autorizado no puede subir', 'FALLA');
  exception when others then
    insert into resultados (prueba, resultado, detalle) values ('No autorizado no puede subir', 'OK', sqlerrm);
  end;
  perform set_config('role', 'postgres', true);

  -- 3. Integrante A
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  select count(*) into n from public.documents where id = doc_b;
  insert into resultados (prueba, resultado)
    values ('A ve documentos de B', case when n = 1 then 'OK' else 'FALLA' end);

  select count(*) into n from public.search_documents('texto buscable', null, null, false, 50) where id = doc_b;
  insert into resultados (prueba, resultado)
    values ('Búsqueda encuentra documento de B', case when n = 1 then 'OK' else 'FALLA' end);

  select count(*) into n from public.search_documents('%', null, null, false, 50) where id = doc_b;
  insert into resultados (prueba, resultado)
    values ('Búsqueda trata % como texto', case when n = 0 then 'OK' else 'FALLA' end);

  begin
    insert into public.documents (title, category, original_filename, storage_path, mime_type, size_bytes, owner_id)
    values ('suplantación', cat, 's.pdf', b::text || '/s.pdf', 'application/pdf', 10, b);
    insert into resultados (prueba, resultado) values ('A no puede subir a nombre de B', 'FALLA');
  exception when others then
    insert into resultados (prueba, resultado, detalle) values ('A no puede subir a nombre de B', 'OK', sqlerrm);
  end;

  begin
    insert into public.documents (title, category, original_filename, storage_path, mime_type, size_bytes)
    values ('malicioso', cat, 'm.exe', a::text || '/m.exe', 'application/x-msdownload', 10);
    insert into resultados (prueba, resultado) values ('Rechaza tipo de archivo no admitido', 'FALLA');
  exception when check_violation then
    insert into resultados (prueba, resultado, detalle) values ('Rechaza tipo de archivo no admitido', 'OK', sqlerrm);
  end;

  insert into public.documents (title, category, original_filename, storage_path, mime_type, size_bytes, created_at)
  values ('propio', cat, 'a.pdf', a::text || '/prueba-a.pdf', 'application/pdf', 10, '2000-01-01')
  returning id, owner_id, created_at into doc_a, dueno, fecha;
  insert into resultados (prueba, resultado)
    values ('A sube documento propio', case when dueno = a then 'OK' else 'FALLA' end);
  insert into resultados (prueba, resultado, detalle)
    values ('Fecha de carga no se puede falsear', case when fecha > '2001-01-01' then 'OK' else 'FALLA' end, fecha::text);

  delete from public.documents where id = doc_b;
  get diagnostics n = row_count;
  insert into resultados (prueba, resultado, detalle)
    values ('A no puede eliminar documento de B', case when n = 0 then 'OK' else 'FALLA' end, n || ' filas');

  update public.documents set title = 'cambiado' where id = doc_a;
  get diagnostics n = row_count;
  insert into resultados (prueba, resultado, detalle)
    values ('Metadatos no editables (MVP)', case when n = 0 then 'OK' else 'FALLA' end, n || ' filas');

  begin
    insert into public.profiles (id, display_name) values (x, 'intruso');
    insert into resultados (prueba, resultado) values ('A no puede crear perfiles', 'FALLA');
  exception when others then
    insert into resultados (prueba, resultado, detalle) values ('A no puede crear perfiles', 'OK', sqlerrm);
  end;

  delete from public.documents where id = doc_a;
  get diagnostics n = row_count;
  insert into resultados (prueba, resultado)
    values ('A elimina su propio documento', case when n = 1 then 'OK' else 'FALLA' end);

  perform set_config('role', 'postgres', true);
  delete from public.documents where id in (doc_a, doc_b);  -- limpieza
end $$;

select prueba, resultado, detalle from resultados order by n;
