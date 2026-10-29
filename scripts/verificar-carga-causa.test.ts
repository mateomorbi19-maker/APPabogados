import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  fichaCargaSchema,
  guardarCargaSchema,
  parsearFichaExtraida,
  MAX_PDF_BYTES,
} from "../src/lib/casos/carga-schema";
import { leerFormularioCarga, validarPdfCarga } from "../src/lib/casos/carga-archivo";

const id = "1b19b778-e3b2-4fae-8777-3acdc47e5113";

test("la extracción deja ausencias vacías y guardar exige rol, título y relato", () => {
  const ficha = fichaCargaSchema.parse({ titulo: "", caso_descripcion: "" });
  assert.equal(ficha.rol, null);
  assert.equal(ficha.organismo, null);
  assert.deepEqual(ficha.partes, []);
  assert.equal(guardarCargaSchema.safeParse({ id, ficha }).success, false);
  const revisada = { ...ficha, titulo: "Causa revisada", caso_descripcion: "Antecedentes aportados", rol: "defensor" };
  assert.equal(guardarCargaSchema.safeParse({ id, ficha: revisada }).success, true);
});

test("normaliza vacíos y delitos, rechaza propietario y estrategia inyectados", () => {
  const ficha = fichaCargaSchema.parse({ titulo: " Título ", caso_descripcion: " Relato ", juez: "  ", delitos: [" Robo ", "robo", ""] });
  assert.equal(ficha.juez, null);
  assert.deepEqual(ficha.delitos, ["Robo"]);
  assert.equal(fichaCargaSchema.safeParse({ ...ficha, usuario_id: id }).success, false);
  assert.equal(fichaCargaSchema.safeParse({ ...ficha, estrategia_snapshot: {} }).success, false);
  assert.equal(fichaCargaSchema.safeParse({ ...ficha, partes: [{ nombre: "  ", rol: "imputado" }] }).success, false);
});

test("limpia fences pero no repara JSON truncado ni acepta campos de control", () => {
  const salida = { ficha: { titulo: "Caso", caso_descripcion: "Relato" }, advertencias: ["Revisar apellido"] };
  assert.equal(parsearFichaExtraida("```json\n" + JSON.stringify(salida) + "\n```").ficha.titulo, "Caso");
  assert.throws(() => parsearFichaExtraida('{"ficha":{"titulo":"Causa"'));
  assert.throws(() => parsearFichaExtraida(JSON.stringify({ ...salida, guardar: true })));
});

test("PDF real válido se lee; falso, vacío, demasiado grande o de más de 100 páginas se rechaza", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = await pdf.save();
  const bueno = await validarPdfCarga(new File([Buffer.from(bytes)], "causa.pdf", { type: "application/pdf" }));
  assert.equal(bueno?.paginas, 1);
  assert.equal(await validarPdfCarga(null), null);
  await assert.rejects(validarPdfCarga(new File(["no soy pdf"], "falso.pdf", { type: "application/pdf" })));
  await assert.rejects(validarPdfCarga(new File([], "vacio.pdf", { type: "application/pdf" })));
  await assert.rejects(validarPdfCarga(new File([new Uint8Array(MAX_PDF_BYTES + 1)], "grande.pdf", { type: "application/pdf" })));
  for (let i = 1; i < 101; i++) pdf.addPage();
  await assert.rejects(validarPdfCarga(new File([Buffer.from(await pdf.save())], "largo.pdf", { type: "application/pdf" })), /100/);
});

test("formulario limita bytes reales aunque no haya Content-Length", async () => {
  const form = new FormData();
  form.set("texto", "Relato");
  const recibido = await leerFormularioCarga(new Request("http://localhost", { method: "POST", body: form }));
  assert.equal(recibido.get("texto"), "Relato");
  await assert.rejects(leerFormularioCarga(new Request("http://localhost", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test" }, body: new Uint8Array(MAX_PDF_BYTES + 1024 * 1024 + 1) })), /grande/);
});
