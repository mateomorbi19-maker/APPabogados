// Render SSR de las tarjetas de acciones de LEXIE con datos fijos.
//
// Sin navegador ni sesión: `renderToStaticMarkup` sobre <AccionesLexie> con
// una acción por estado, y se afirma que el HTML dice lo que tiene que decir
// (la etiqueta de cada estado, los dos botones de la pendiente, el link «Ver»,
// y el aviso «Superada…» cuando las pendientes ya no están activas). Es cliente
// puro: se corre con tsx a secas, SIN `--conditions=react-server`.
//
//   npx tsx scripts/verificar-lexie-tarjetas.tsx

import { renderToStaticMarkup } from "react-dom/server";
import { AccionesLexie } from "../src/components/lexie/acciones-lexie";
import type { AccionLexie } from "../src/lib/lexie/acciones";

const ACCIONES: AccionLexie[] = [
  {
    tool: "agenda_crear_evento",
    estado: "ok",
    resumen: "Audiencia Pérez, mar 10/09 10:00",
    seccion: "agenda",
    vista_previa: {
      titulo: "Audiencia de control de detención — Pérez",
      inicio: "martes 10/09/2026 10:00",
      lugar: "Juzgado de Garantías N° 2, Mar del Plata",
    },
    datos: { href: "/dashboard/agenda?evento=ev-1", evento_id: "ev-1" },
    antes: { titulo: "Audiencia Pérez", inicio: "lunes 09/09/2026 10:00" },
  },
  {
    tool: "correo_enviar",
    estado: "pendiente",
    clave: "correo_enviar:0123456789abcdef",
    resumen: "Correo a fiscalia@mpba.gov.ar: Pedido de copias",
    seccion: "bandeja",
    vista_previa: {
      para: ["fiscalia@mpba.gov.ar"],
      asunto: "Pedido de copias — IPP 08-00-012345-26",
      cuerpo:
        "Estimados:\n\nSolicito copias digitales de las fojas 1 a 40 de la IPP de referencia.\n\nSaludos cordiales,\nMateo Morbiducci",
      adjuntos: [{ nombre: "escrito.pdf", tamaño: 120_000 }],
    },
    payload: { para: ["fiscalia@mpba.gov.ar"] },
  },
  {
    tool: "generar_escrito_causa",
    estado: "en_curso",
    clave: "generar_escrito_causa:fedcba9876543210",
    resumen: "Escrito «Pedido de excarcelación» para Pérez",
    seccion: "escritos",
  },
  {
    tool: "ficha_editar",
    estado: "rechazada",
    resumen: "Cambiar el fuero de la causa Pérez",
    seccion: "causa",
    motivo: "El mapa procesal ya está armado y el fuero queda congelado.",
    sugerencia: "Reiniciá el mapa desde la ficha si de verdad hay que cambiarlo.",
  },
  {
    tool: "agenda_eliminar_evento",
    estado: "descartada",
    clave: "agenda_eliminar_evento:1111222233334444",
    resumen: "Borrar «Vencimiento apelación» del 12/09",
    seccion: "agenda",
  },
  {
    tool: "correo_enviar",
    estado: "error",
    clave: "correo_enviar:5555666677778888",
    resumen: "Correo a defensor@ejemplo.com: Re: Pericia",
    seccion: "bandeja",
    error: "Gmail devolvió 403: el scope gmail.send no está concedido.",
  },
];

function render(activas: boolean, ocupada: string | null = null): string {
  return renderToStaticMarkup(
    <AccionesLexie
      acciones={ACCIONES}
      activas={activas}
      ocupada={ocupada}
      // Sobre la pendiente: en una resuelta el aviso no se pinta (ya cuenta qué pasó).
      avisos={{
        "correo_enviar:0123456789abcdef": "Esa acción ya no está pendiente.",
        "correo_enviar:5555666677778888": "NO DEBERÍA VERSE",
      }}
      onConfirmar={() => {}}
      onDescartar={() => {}}
    />,
  );
}

let fallos = 0;
function afirmar(cond: boolean, que: string) {
  console.log(`${cond ? "OK " : "FAIL"} ${que}`);
  if (!cond) fallos++;
}

const activo = render(true);
const superado = render(false);
const ejecutando = render(true, "correo_enviar:0123456789abcdef");

afirmar(activo.includes("Esperando tu confirmación"), "pendiente: encabezado «Esperando tu confirmación»");
afirmar(activo.includes(">Confirmar<") || /Confirmar<\/button>/.test(activo), "pendiente: botón «Confirmar»");
afirmar(activo.includes("Cancelar"), "pendiente: botón «Cancelar»");
afirmar(activo.includes("Pedido de copias — IPP 08-00-012345-26"), "pendiente: vista_previa completa (asunto)");
afirmar(activo.includes("Solicito copias digitales"), "pendiente: vista_previa completa (cuerpo largo)");
afirmar(activo.includes("escrito.pdf"), "pendiente: arrays de objetos listados");
afirmar(activo.includes("Hecho"), "ok: etiqueta «Hecho»");
afirmar(activo.includes('href="/dashboard/agenda?evento=ev-1"'), "ok: link «Ver» a datos.href");
afirmar(/>Ver</.test(activo), "ok: texto del link «Ver»");
afirmar(activo.includes("Antes"), "ok: detalle colapsable «Antes»");
afirmar(activo.includes("En curso"), "en_curso: etiqueta");
afirmar(activo.includes("No se hizo") && activo.includes("queda congelado"), "rechazada: etiqueta + motivo");
afirmar(activo.includes("Reiniciá el mapa"), "rechazada: sugerencia");
afirmar(activo.includes("Descartada") && activo.includes("line-through"), "descartada: etiqueta + tachado");
afirmar(activo.includes("Falló") && activo.includes("gmail.send"), "error: etiqueta + mensaje");
afirmar(activo.includes("Esa acción ya no está pendiente."), "aviso por clave se pinta sobre la pendiente");
afirmar(!activo.includes("NO DEBERÍA VERSE"), "aviso por clave NO se pinta sobre una resuelta");
afirmar(!activo.includes("Superada"), "activas=true: sin «Superada»");

afirmar(superado.includes("Superada por un mensaje posterior"), "activas=false: «Superada por un mensaje posterior»");
afirmar(!/Confirmar<\/button>/.test(superado), "activas=false: sin botón Confirmar");

afirmar(ejecutando.includes("Ejecutando…"), "ocupada=clave: «Ejecutando…»");
afirmar(/disabled/.test(ejecutando), "ocupada=clave: botones deshabilitados");

afirmar(!/bg-(amber|emerald|rose)-\d+\b(?!\/)/.test(activo), "sin fondos con literal opaco de la paleta");

console.log(`\n${fallos === 0 ? "TODO OK" : `${fallos} fallo(s)`} — HTML activo: ${activo.length} bytes`);
if (process.env.VER_HTML) console.log(activo);
process.exit(fallos === 0 ? 0 : 1);
