// PostgreSQL real embebido, aislado y sin red ni base remota.
// Instalar @electric-sql/pglite FUERA del repo. Luego:
// node scripts/verificar-carga-sql.mjs <carpeta-runtime>/node_modules/@electric-sql/pglite/dist/index.js
// El fixture usa las migraciones reales de casos/eventos y ficha; no usa secretos.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const runtime = process.argv[2];
const { PGlite } = runtime
  ? await import(pathToFileURL(resolve(runtime)).href)
  : await import("@electric-sql/pglite");
const db = new PGlite();
const root = new URL("../", import.meta.url);
const migration = await readFile(new URL("supabase/migrations/20261029120000_carga_causa.sql", root), "utf8");
const migrationOriginal = await readFile(new URL("supabase/migrations/20260501003519_casos_y_eventos_caso.sql", root), "utf8");
const migrationFicha = await readFile(new URL("supabase/migrations/20260822120000_ficha_de_causa.sql", root), "utf8");

const usuario = "10000000-0000-4000-8000-000000000001";
const otroUsuario = "10000000-0000-4000-8000-000000000002";
const caso = "20000000-0000-4000-8000-000000000001";
const huella = "a".repeat(64);
const ficha = {
  titulo: "Causa de prueba", caso_descripcion: "Relato revisado por el abogado.", rol: "defensor",
  caratula: null, expediente_numero: "123/2026", organismo: null, secretaria: null,
  juez: null, fiscalia: null, delitos: ["Delito informado"], fuero: "pba", estado_seguimiento: "activa",
  partes: [{ nombre: "Persona de prueba", rol: "imputado", es_cliente: true, situacion_libertad: "libre", documento: "DNI de prueba" }],
  usuario_id: otroUsuario, contexto: { texto_original: "NO DEBE PERSISTIR" },
};
const adjunto = {
  filename: "prueba.pdf", storage_path: `${usuario}/${caso}/carga-${"b".repeat(64)}.pdf`,
  mime_type: "application/pdf", size_bytes: 123, descripcion: "Documento inicial",
  texto_original: "NO DEBE PERSISTIR",
};
let pruebas = 0;
function ok(label) { pruebas++; console.log(`OK ${label}`); }
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const call = async (id = caso, owner = usuario, data = ficha, file = adjunto, hash = huella, preflight = false) =>
  scalar("SELECT public.crear_causa_importada($1::uuid,$2::uuid,$3::jsonb,$4::jsonb,$5::text,$6::boolean)",
    [id, owner, JSON.stringify(data), file === null ? null : JSON.stringify(file), hash, preflight]);
const count = async (table, id) => Number(await scalar(`SELECT count(*) FROM public.${table} WHERE ${table === "casos" ? "id" : "caso_id"}=$1::uuid`, [id]));
const rejects = async (operation, code) => {
  await assert.rejects(operation, (error) => error.code === code, `Se esperaba SQLSTATE ${code}`);
};

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.usuarios (id uuid PRIMARY KEY);
    CREATE TABLE public.ejecuciones (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tipo text NOT NULL CHECK (tipo IN (
      'pre_analisis','analizar_caso','consulta_caso','simular_mapa','simular_audiencia','lexie','generar_escrito','reporte_cliente','tipo_historico'
    )));
  `);
  await db.exec(migrationOriginal);
  await db.exec(migrationFicha);
  await db.exec(`
    ALTER TABLE public.casos ADD COLUMN fuero text CHECK (fuero IN ('nacion','pba','federal'));
    ALTER TABLE public.partes_caso ADD COLUMN documento text;
    ALTER TABLE public.eventos_caso ADD COLUMN categoria text, ADD COLUMN adjuntos jsonb NOT NULL DEFAULT '[]'::jsonb;
    GRANT USAGE ON SCHEMA public TO service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
  `);
  await db.query("INSERT INTO public.usuarios (id) VALUES ($1::uuid),($2::uuid)", [usuario, otroUsuario]);
  await db.exec(migration);
  ok("migración compila sobre fixture de migraciones reales");

  assert.deepEqual((await db.query(`SELECT
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role, prosecdef
    FROM pg_proc p WHERE p.oid='public.crear_causa_importada(uuid,uuid,jsonb,jsonb,text,boolean)'::regprocedure`)).rows[0],
    { anon: false, authenticated: false, service_role: true, prosecdef: false });
  const config = await scalar("SELECT proconfig FROM pg_proc WHERE oid='public.crear_causa_importada(uuid,uuid,jsonb,jsonb,text,boolean)'::regprocedure");
  assert.deepEqual(config, ['search_path=""']);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    await rejects(() => call(caso, usuario, {}, null, "", true), "42501");
    await db.exec("RESET ROLE");
  }
  ok("INVOKER, search_path vacío y ejecución denegada para roles públicos");

  await db.exec("SET ROLE service_role");
  assert.equal(await call(caso, usuario, {}, null, "", true), null);
  for (const table of ["casos", "partes_caso", "eventos_caso"]) assert.equal(await count(table, caso), 0);
  ok("preflight admite borrador vacío y no escribe");
  assert.equal(await call(), caso);
  const creada = (await db.query("SELECT * FROM public.casos WHERE id=$1::uuid", [caso])).rows[0];
  assert.equal(creada.usuario_id, usuario);
  for (const key of ["estrategia_snapshot", "estrategia_seleccionada_rol", "estrategia_seleccionada_idx", "ejecucion_origen_id"]) assert.equal(creada[key], null);
  assert.deepEqual(creada.contexto, { carga_inicial: { huella } });
  const parte = (await db.query("SELECT * FROM public.partes_caso WHERE caso_id=$1::uuid", [caso])).rows[0];
  assert.equal(parte.documento, "DNI de prueba");
  const evento = (await db.query("SELECT * FROM public.eventos_caso WHERE caso_id=$1::uuid", [caso])).rows[0];
  assert.equal(evento.tipo, "sistema"); assert.equal(evento.categoria, null);
  assert.equal(evento.adjuntos.length, 1); assert.equal(evento.adjuntos[0].texto_original, undefined);
  ok("alta causa+parte+evento PDF, sin estrategia ni texto original ni columnas ajenas");

  assert.equal(await call(), caso);
  for (const table of ["casos", "partes_caso", "eventos_caso"]) assert.equal(await count(table, caso), 1);
  await rejects(() => call(caso, otroUsuario), "23505");
  await rejects(() => call(caso, usuario, ficha, adjunto, "c".repeat(64)), "23505");
  ok("reintento idempotente y conflictos de propietario/huella");
  await rejects(() => db.query("UPDATE public.casos SET estrategia_seleccionada_idx=0 WHERE id=$1::uuid", [caso]), "23514");
  ok("CHECK rechaza estrategia parcial");
  await db.query(`INSERT INTO public.casos (
      usuario_id,titulo,caso_descripcion,rol,estrategia_seleccionada_rol,estrategia_seleccionada_idx,estrategia_snapshot
    ) VALUES ($1::uuid,'Creación desde análisis','Relato analizado','defensor','defensor',0,'{}'::jsonb)`, [usuario]);
  ok("alta previa con selección completa de estrategia sigue válida");

  const sinPdf = "20000000-0000-4000-8000-000000000002";
  assert.equal(await call(sinPdf, usuario, ficha, null), sinPdf);
  assert.deepEqual(await scalar("SELECT adjuntos FROM public.eventos_caso WHERE caso_id=$1::uuid", [sinPdf]), []);
  ok("alta sin PDF también disponible");
  const invalido = "20000000-0000-4000-8000-000000000003";
  await rejects(() => call(invalido, usuario, ficha, adjunto), "22023");
  assert.equal(await count("casos", invalido), 0);
  ok("PDF con prefijo ajeno rechazado sin escribir");

  await db.exec("RESET ROLE");
  for (const table of ["partes_caso", "eventos_caso"]) {
    await db.exec(`CREATE OR REPLACE FUNCTION public.rechazar_prueba() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fallo forzado' USING ERRCODE='P0001'; END; $$;
      CREATE TRIGGER rechazar_prueba BEFORE INSERT ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.rechazar_prueba();`);
    const fallido = table === "partes_caso" ? "20000000-0000-4000-8000-000000000004" : "20000000-0000-4000-8000-000000000005";
    await db.exec("SET ROLE service_role");
    await rejects(() => call(fallido, usuario, ficha, null), "P0001");
    for (const target of ["casos", "partes_caso", "eventos_caso"]) assert.equal(await count(target, fallido), 0);
    await db.exec(`RESET ROLE; DROP TRIGGER rechazar_prueba ON public.${table};`);
    ok(`rollback total ante fallo forzado en ${table}`);
  }
  await db.exec(migration);
  await db.exec("SET ROLE service_role");
  assert.equal(await call(), caso);
  await db.query("INSERT INTO public.ejecuciones(tipo) VALUES ('importar_causa'),('tipo_historico'),('reporte_cliente')");
  ok("migración repetible conserva datos, reintentos y tipos existentes");
  console.log(`\n${pruebas} verificaciones SQL pasaron. Base efímera local; no hubo conexión remota.`);
} finally {
  await db.close();
}
