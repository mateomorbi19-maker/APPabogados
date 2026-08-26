import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import { nombreCaso } from "@/lib/casos/nombre";
import { CATALOGO } from "@/lib/repositorio/catalogo";
import { documentoPorId } from "@/lib/repositorio/buscar";
import type { Ubicacion } from "@/lib/lexie/ubicacion";
import type { CasoNombrable } from "@/lib/types";

// Le pone nombre a lo que el abogado tiene abierto en pantalla.
//
// === La regla que gobierna este archivo ===
//
// El cliente manda un pathname y NADA más. El id que viene ahí adentro lo eligió
// el browser, no el servidor, así que se trata con la misma desconfianza que un
// id que viene del modelo en `lexie-tools.ts`: **se verifica propiedad ANTES de
// leer nada**, y el filtro va dentro de la query, porque el server entra con
// service_role y bypassa RLS.
//
// Si no se puede verificar, se devuelve `null` y el turno viaja solo con la
// sección. Un pathname manipulado no revela ni la carátula de una causa ajena,
// y —lo que importa igual— LEXIE no repite un nombre que no salió de la base.

/**
 * El nombre de la entidad abierta, o `null` si la ubicación no tiene entidad,
 * si no es del abogado, o si algo falló.
 *
 * Nunca tira: la línea de ubicación es un adorno del turno, no puede voltear
 * una consulta.
 */
export async function resolverNombreEntidad(
  ubicacion: Ubicacion,
  usuarioId: string,
): Promise<string | null> {
  const entidad = ubicacion.entidad;
  if (!entidad) return null;

  try {
    if (entidad.tipo === "caso") {
      const supabase = createServerClient();
      // El `.eq("usuario_id", …)` es el control de propiedad, y va en la misma
      // query que trae el nombre: verificar en un SELECT y leer en otro abre
      // una ventana entre el chequeo y la lectura.
      const { data, error } = await supabase
        .from("casos")
        .select("id, titulo, caratula")
        .eq("id", entidad.id)
        .eq("usuario_id", usuarioId)
        .maybeSingle();
      if (error || !data) return null;
      return nombreCaso(data as CasoNombrable);
    }

    if (entidad.tipo === "documento") {
      // El repositorio es la biblioteca compartida del estudio: no está
      // scopeada por usuario, así que acá no hay nada que verificar.
      const doc = documentoPorId(CATALOGO, entidad.id);
      return doc?.titulo ?? null;
    }
  } catch (e) {
    console.error("[lexie] no pude resolver la entidad de la pantalla:", e);
  }

  return null;
}
