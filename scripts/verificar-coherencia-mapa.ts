/* Verificación de coherencia.ts contra los mapas REALES de la DB. Solo lectura. */
import { createServerClient } from "@/lib/supabase/server";
import { validarAccion, type AccionValidable } from "@/lib/mapa-procesal/coherencia";
import type { NodoProcesalDB, Fuero } from "@/lib/mapa-procesal/types";

async function main() {
const sb = createServerClient();

const { data: casos, error: e1 } = await sb
  .from("casos")
  .select("id, titulo, fuero")
  .order("creado_en", { ascending: false });
if (e1) throw new Error(e1.message);

let fallos = 0;
const ok = (c: boolean, m: string) => {
  if (!c) { fallos++; console.log("    ✗ " + m); } else console.log("    ✓ " + m);
};

for (const caso of casos ?? []) {
  const { data: nodos } = await sb
    .from("mapa_procesal_nodos")
    .select("id, caso_id, titulo, descripcion, tipo, estado, padre_id, posicion_x, posicion_y, riesgo_alto, metadata, created_at, updated_at")
    .eq("caso_id", caso.id);
  const ns = (nodos ?? []) as NodoProcesalDB[];
  const fuero = (caso.fuero ?? null) as Fuero | null;
  console.log(`\n── caso ${caso.id.slice(0, 8)} "${String(caso.titulo).slice(0, 40)}" fuero=${fuero ?? "NULL"} nodos=${ns.length}`);
  if (ns.length === 0) {
    const r = validarAccion({ tipo: "crear", padre_ref: "xxxxxxxx", titulo: "X" }, ns, fuero);
    ok(!r.ok, `mapa vacío rechaza crear (${r.ok ? "-" : r.regla})`);
    continue;
  }

  const raiz = ns.find((n) => n.tipo === "raiz")!;
  const hojas = ns.filter((n) => !ns.some((m) => m.padre_id === n.id));
  const noOcurridos = ns.filter((n) => n.estado !== "ocurrido");

  const pruebas: [AccionValidable, (r: ReturnType<typeof validarAccion>) => boolean, string][] = [
    [{ tipo: "eliminar", nodo_ref: raiz.id.slice(0, 8) },
      (r) => !r.ok && r.regla === "R6_RAIZ_PROTEGIDA", "R6: no se puede eliminar la raíz"],
    [{ tipo: "marcar_ocurrido", nodo_ref: raiz.id.slice(0, 8) },
      (r) => !r.ok && r.regla === "R6_RAIZ_PROTEGIDA", "R6: no se puede marcar la raíz"],
    [{ tipo: "crear", padre_ref: "00000000", titulo: "Fantasma" },
      (r) => !r.ok && r.regla === "R1_PADRE_INEXISTENTE", "R1: padre inexistente"],
    [{ tipo: "crear", padre_ref: raiz.id.slice(0, 8), titulo: raiz.titulo },
      (r) => r.ok || r.regla !== "R1_PADRE_INEXISTENTE", "R1: prefijo de 8 resuelve el padre real"],
    // R9 frena el primer intento pero es CONFIRMABLE: el servidor no puede
    // decidir la semántica jurídica de un título arbitrario, así que la última
    // palabra la tiene el abogado (el modelo se lo consulta y reintenta con
    // confirmar: true).
    [{ tipo: "crear", padre_ref: raiz.id, titulo: "Absolución", riesgo_alto: true },
      (r) => !r.ok && r.regla === "R9_RIESGO_EN_DESENLACE_FAVORABLE" && r.requiere_confirmacion === true,
      "R9: absolución no puede ser riesgo alto (confirmable)"],
    [{ tipo: "crear", padre_ref: raiz.id, titulo: "Sobreseimiento", riesgo_alto: true },
      (r) => !r.ok && r.regla === "R9_RIESGO_EN_DESENLACE_FAVORABLE" && r.requiere_confirmacion === true,
      "R9: sobreseimiento tampoco (confirmable)"],
    // Negadores: el instituto favorable aparece NEGADO, o sea que el nodo es
    // adverso al imputado y el rojo corresponde. R9 no debe dispararse.
    [{ tipo: "crear", padre_ref: raiz.id, titulo: "Rechazo del pedido de excarcelación", riesgo_alto: true },
      (r) => r.ok || r.regla !== "R9_RIESGO_EN_DESENLACE_FAVORABLE",
      "R9: un RECHAZO de un instituto favorable sí puede ir en rojo"],
    [{ tipo: "crear", padre_ref: raiz.id, titulo: "Revocación de la suspensión del juicio a prueba", riesgo_alto: true },
      (r) => r.ok || r.regla !== "R9_RIESGO_EN_DESENLACE_FAVORABLE",
      "R9: una REVOCACIÓN de un instituto favorable también"],
  ];

  const hijosRaiz = ns.filter((n) => n.padre_id === raiz.id);
  if (hijosRaiz.length) {
    pruebas.push([{ tipo: "crear", padre_ref: raiz.id, titulo: hijosRaiz[0].titulo },
      (r) => !r.ok && r.regla === "R2_TITULO_DUPLICADO_HERMANO", "R2: título duplicado entre hermanos"]);
  }
  // Solo los desenlaces que SON hoja del árbol canónico disparan R4. Un nodo
  // como "Sentencia condenatoria" no está en ninguna plantilla y además admite
  // continuación legítima (recursos, ejecución), así que no debe disparar.
  const terminal = hojas.find((h) => /absoluc|sobresei/i.test(h.titulo));
  if (terminal) {
    pruebas.push([{ tipo: "crear", padre_ref: terminal.id, titulo: "Algo después del final" },
      (r) => !r.ok && (r.regla === "R4_HIJO_DE_TERMINAL" || !!r.requiere_confirmacion),
      `R4: hijo de terminal "${terminal.titulo.slice(0, 30)}" pide confirmación`]);
  }
  const profundo = noOcurridos.find((n) => {
    let p = n.padre_id, saltos = 0;
    while (p && saltos < 20) { const pn = ns.find((x) => x.id === p); if (!pn) break; if (pn.estado !== "ocurrido") return true; p = pn.padre_id; saltos++; }
    return false;
  });
  if (profundo) {
    pruebas.push([{ tipo: "marcar_ocurrido", nodo_ref: profundo.id },
      (r) => !r.ok && r.regla === "R5_ANCESTROS_NO_OCURRIDOS",
      `R5: "${profundo.titulo.slice(0, 30)}" con ancestros pendientes`]);
  }

  for (const [accion, esperado, desc] of pruebas) {
    const r = validarAccion(accion, ns, fuero);
    ok(esperado(r), `${desc}${r.ok ? "" : ` → ${r.regla}`}`);
  }

  // El uuid completo devuelto nunca puede ser un prefijo.
  const rok = validarAccion({ tipo: "crear", padre_ref: raiz.id.slice(0, 8), titulo: "Nodo de prueba único xyz" }, ns, fuero);
  ok(rok.ok && rok.nodo?.id === raiz.id, "resolución por prefijo devuelve el uuid COMPLETO");
  if (rok.ok && rok.advertencias.length) console.log("      advertencias:", rok.advertencias.map((a) => a.slice(0, 70)));
}

console.log(`\n${fallos === 0 ? "TODO OK" : fallos + " FALLOS"} — ninguna fila fue modificada\n`);
process.exit(fallos === 0 ? 0 : 1);
}
main();
