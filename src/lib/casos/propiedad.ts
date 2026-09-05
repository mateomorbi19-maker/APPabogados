// ¿Esta causa es de este abogado? — UNA sola respuesta para todo el repo.
//
// Hasta la Fase 11 había cuatro copias de esta función: `agenda/queries.ts`,
// `mapa-procesal/queries.ts` y una `casoPropio` privada en cada ruta de partes.
// Dos tiraban ante un error de la base y dos lo tragaban devolviendo `false`,
// o sea que la misma pregunta podía contestar "no es tuya" cuando en realidad
// la base estaba caída. Con LEXIE pasando a escribir sobre la ficha, el guard
// se vuelve la única barrera de verdad y no puede tener cuatro versiones.
//
// Por qué esto es LA barrera y no una más: el server entra siempre con la
// `service_role` key, que bypassa RLS. No hay red debajo. Todo `caso_id` que
// venga de una URL o —peor— del modelo pasa por acá ANTES de leer o escribir
// cualquier cosa que cuelgue del caso (partes, eventos, nodos del mapa,
// escritos). Y en las tablas que sí tienen `usuario_id`, este chequeo NO
// reemplaza el `.eq("usuario_id", …)` dentro del UPDATE/DELETE: son dos capas,
// una evita la ventana entre chequear y escribir y la otra protege a las
// tablas hijas que no tienen la columna.
//
// Ante un error de la base TIRA, no devuelve `false`: un `false` se traduce en
// 404 "Caso no encontrado", y eso le diría al abogado que su causa no existe
// cuando lo que pasó es que la consulta falló. Las rutas lo atrapan y
// responden 500 con el detalle en desarrollo, igual que el resto de los reads.

import "server-only";
import { createServerClient } from "@/lib/supabase/server";

export async function casoEsDelUsuario(
  casoId: string,
  usuarioId: string,
): Promise<boolean> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("casos")
    .select("id")
    .eq("id", casoId)
    .eq("usuario_id", usuarioId)
    .maybeSingle();
  if (error) throw new Error(`casoEsDelUsuario: ${error.message}`);
  return data !== null;
}
