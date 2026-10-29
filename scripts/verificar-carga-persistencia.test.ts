import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { guardarCausaImportada, verificarCargaDisponible } from "../src/lib/casos/carga-persistencia";
import { fichaCargaSchema } from "../src/lib/casos/carga-schema";

const id = "1b19b778-e3b2-4fae-8777-3acdc47e5113";
const usuario = "7276276b-68b3-4945-b4f9-7811c0253ce6";
const ficha = fichaCargaSchema.parse({ titulo: "Causa", caso_descripcion: "Antecedentes", rol: "defensor" });

function baseDePrueba(opciones: { sqlError?: boolean; migracionFalta?: boolean; storageError?: boolean; duplicado?: number; archivoExistente?: Buffer; sqlFallaUnaVez?: boolean } = {}) {
  let guardado: { contexto: { carga_inicial: { huella: string } } } | null = null;
  let altas = 0;
  let subidas = 0;
  let sqlIntentos = 0;
  let archivoSubido: BodyInit | null = null;
  const client = createClient("https://supabase.test", "clave-ficticia", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname.includes("/rpc/")) {
        const body = JSON.parse(String(init?.body));
        if (opciones.migracionFalta) return Response.json({ code: "PGRST202", message: "No function" }, { status: 404 });
        if (body.p_solo_validar) return Response.json(null);
        sqlIntentos++;
        if (opciones.sqlError || (opciones.sqlFallaUnaVez && sqlIntentos === 1)) return Response.json({ code: "23514", message: "constraint" }, { status: 400 });
        assert.equal(body.p_usuario_id, usuario);
        assert.equal(body.p_ficha.rol, "defensor");
        assert.equal(body.p_ficha.usuario_id, undefined);
        guardado = { contexto: { carga_inicial: { huella: body.p_huella } } };
        altas++;
        return Response.json(id);
      }
      if (url.pathname.includes("/storage/")) {
        if (!init?.method || init.method === "GET") return new Response(opciones.archivoExistente ? Uint8Array.from(opciones.archivoExistente).buffer : archivoSubido ?? "PDF previo");
        subidas++;
        assert.ok(url.pathname.includes(`${usuario}/${id}/carga-`));
        if (opciones.storageError) return Response.json({ statusCode: "500", error: "StorageError", message: "fallo" }, { status: 500 });
        if (opciones.duplicado && (!opciones.sqlFallaUnaVez || subidas > 1)) {
          const body = opciones.duplicado === 400 ? { statusCode: "400", error: "Duplicate", message: "The resource already exists" } : { code: "ResourceAlreadyExists", message: "The resource already exists" };
          return Response.json(body, { status: opciones.duplicado });
        }
        archivoSubido = init.body ?? null;
        return Response.json({ Key: "archivo" });
      }
      assert.equal(url.searchParams.get("usuario_id"), `eq.${usuario}`);
      assert.equal(url.searchParams.get("id"), `eq.${id}`);
      return Response.json(guardado ? [guardado] : []);
    } },
  });
  return { client, contadores: () => ({ altas, subidas }) };
}

test("alta sin PDF y reintento devuelven la misma causa sin duplicar escritura", async () => {
  const b = baseDePrueba();
  assert.equal(await guardarCausaImportada(b.client, usuario, { id, ficha }, null), id);
  assert.equal(await guardarCausaImportada(b.client, usuario, { id, ficha }, null), id);
  assert.deepEqual(b.contadores(), { altas: 1, subidas: 0 });
  await assert.rejects(guardarCausaImportada(b.client, usuario, { id, ficha: { ...ficha, titulo: "Distinto" } }, null), /ya/);
});

test("PDF usa ruta del propietario; reintentar no vuelve a subirlo", async () => {
  const b = baseDePrueba();
  const pdf = { bytes: Buffer.from("PDF de prueba"), filename: "causa.pdf", paginas: 1 };
  await guardarCausaImportada(b.client, usuario, { id, ficha }, pdf);
  await guardarCausaImportada(b.client, usuario, { id, ficha }, pdf);
  assert.deepEqual(b.contadores(), { altas: 1, subidas: 1 });
});

test("fallos de storage o SQL nunca se informan como causa creada", async () => {
  const b = baseDePrueba({ storageError: true });
  await assert.rejects(guardarCausaImportada(b.client, usuario, { id, ficha }, { bytes: Buffer.from("PDF"), filename: "causa.pdf", paginas: 1 }));
  assert.equal(b.contadores().altas, 0);
  const sql = baseDePrueba({ sqlError: true });
  await assert.rejects(guardarCausaImportada(sql.client, usuario, { id, ficha }, null));
});

test("preflight detecta migración ausente sin escribir", async () => {
  const b = baseDePrueba();
  await verificarCargaDisponible(b.client, usuario);
  assert.deepEqual(b.contadores(), { altas: 0, subidas: 0 });
  await assert.rejects(verificarCargaDisponible(baseDePrueba({ migracionFalta: true }).client, usuario), /habilitada/);
});

test("un PDF subido antes de un fallo SQL se reutiliza con duplicado Storage 400 o 409", async () => {
  for (const status of [400, 409]) {
    const b = baseDePrueba({ duplicado: status, sqlFallaUnaVez: true });
    const pdf = { bytes: Buffer.from("PDF previo"), filename: "causa.pdf", paginas: 1 };
    await assert.rejects(guardarCausaImportada(b.client, usuario, { id, ficha }, pdf));
    assert.equal(await guardarCausaImportada(b.client, usuario, { id, ficha }, pdf), id);
    assert.equal(b.contadores().altas, 1);
  }
});

test("un conflicto de Storage con bytes distintos no crea la causa ni pisa el PDF", async () => {
  const b = baseDePrueba({ duplicado: 400, archivoExistente: Buffer.from("otro archivo") });
  await assert.rejects(guardarCausaImportada(b.client, usuario, { id, ficha }, { bytes: Buffer.from("PDF propio"), filename: "causa.pdf", paginas: 1 }));
  assert.equal(b.contadores().altas, 0);
});
