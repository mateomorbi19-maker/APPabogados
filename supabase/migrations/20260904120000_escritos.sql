-- Fase 10 — Escritos judiciales: modelos + generación adaptada a la causa.
--
-- ESTE ARCHIVO NO FUE EJECUTADO por Claude Code. Lo corre Mateo a mano en el
-- SQL Editor de Supabase (ver MIGRATION_LOG.md). Hasta que se aplique:
--   - la lista de escritos de una causa devuelve 500 (tabla inexistente),
--   - generar un escrito falla al persistirlo,
--   - el insert en `ejecuciones` con tipo 'generar_escrito' viola el CHECK,
--   - el formulario de personas no puede guardar el DNI.
-- Los 50 modelos del estudio NO dependen de esta migración: viven en un módulo
-- TS versionado (src/lib/escritos/catalogo-estudio.ts).
--
-- ============================================================
-- Qué problema resuelve
-- ============================================================
-- Pedido de Gonzalo (8/8/2026): desde la ficha de la causa, sin salir de ella,
-- elegir un modelo de escrito, que se genere el PDF "amoldado al expediente
-- con los datos esenciales del mismo", y llevarlo al portal judicial. Con dos
-- flujos separados para los modelos: los que cargó el estudio y los que trae
-- cada abogado. Y que LEXIE recomiende cuál presentar, esté o no en el
-- catálogo; si no está, que lo redacte ella y lo sume.
--
-- Cuatro piezas, en orden de dependencia:
--
--   1. usuarios: el perfil PROFESIONAL del abogado. Todo escrito arranca con
--      "Fulano, abogado, T° X F° Y, con domicilio constituido en..., y
--      electrónico...". Son cuatro datos estables por abogado que hoy no
--      existen en ningún lado: `usuarios.nombre` es el nombre de pila que
--      identifica al usuario en el sistema ("Mateo"), no una firma.
--
--   2. partes_caso.documento: el DNI. El encabezado de todo escrito lo pide
--      ("{{IMPUTADO}}, DNI {{DNI}}") y la tabla no lo tenía. Es un dato de
--      IDENTIDAD, no de contacto: la decisión de esperar a la P1 de REPORTERIA
--      antes de modelar teléfono, mail y dirección sigue en pie.
--
--   3. modelos_escrito: los modelos PROPIOS de cada abogado (y los que LEXIE
--      redacta a pedido). Los 50 del estudio no están acá a propósito.
--
--   4. escritos_generados: cada escrito redactado para una causa. El TEXTO se
--      persiste; el PDF se arma a pedido desde el texto. Así el abogado lo
--      corrige y lo vuelve a bajar sin pagar otra generación.

-- ============================================================
-- 1. usuarios — perfil profesional
-- ============================================================
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS nombre_completo        text,
  ADD COLUMN IF NOT EXISTS matricula              text,
  ADD COLUMN IF NOT EXISTS domicilio_constituido  text,
  ADD COLUMN IF NOT EXISTS domicilio_electronico  text;

COMMENT ON COLUMN usuarios.nombre_completo IS
  'Nombre con el que firma los escritos ("Dr. Mateo Morbiducci"). Distinto de `nombre`, que es el identificador lógico del sistema.';
COMMENT ON COLUMN usuarios.matricula IS
  'Tomo y folio tal como se escriben en el encabezado ("T° 123 F° 456 C.P.A.C.F."). Texto libre: cada colegio lo escribe distinto.';
COMMENT ON COLUMN usuarios.domicilio_constituido IS
  'Domicilio procesal que se constituye en cada escrito.';
COMMENT ON COLUMN usuarios.domicilio_electronico IS
  'Domicilio electrónico (CUIT/CUIL del sistema de notificaciones del fuero).';

-- ============================================================
-- 2. partes_caso — documento
-- ============================================================
ALTER TABLE partes_caso
  ADD COLUMN IF NOT EXISTS documento text;

COMMENT ON COLUMN partes_caso.documento IS
  'DNI u otro documento, texto libre ("DNI 30.123.456", "Pasaporte AB123"). Lo consumen los escritos; NULL se muestra vacío y el redactor deja [COMPLETAR: DNI].';

-- ============================================================
-- 3. modelos_escrito — los modelos que trae cada abogado
-- ============================================================
-- `usuario_id` NOT NULL: no hay modelos "del estudio" en esta tabla. Los 50
-- que redactó Gonzalo viven en código, así que un modelo en la tabla es
-- SIEMPRE de un abogado concreto, y sólo él lo ve. Compartir un modelo entre
-- los tres queda para cuando alguien lo pida: hoy sería una columna de
-- visibilidad que nadie va a usar.
--
-- `origen` distingue el que cargó el abogado a mano ('abogado') del que
-- redactó LEXIE cuando el catálogo no tenía lo que hacía falta ('lexie'). Es
-- la única escritura que LEXIE puede hacer (v1 de solo lectura en todo lo
-- demás), y el origen queda visible para que el abogado sepa qué revisar con
-- más cuidado.
--
-- `archivado` en vez de DELETE: un escrito generado apunta al modelo por id, y
-- borrar el modelo dejaría ese vínculo colgado. Archivado desaparece del
-- catálogo y sigue resolviendo el nombre en el historial.
CREATE TABLE IF NOT EXISTS modelos_escrito (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id      uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  origen          text NOT NULL DEFAULT 'abogado'
    CHECK (origen IN ('abogado', 'lexie')),
  categoria       text NOT NULL DEFAULT 'otro'
    CHECK (categoria IN (
      'actos_iniciales', 'libertad_coercion', 'prueba', 'victima_querella',
      'nulidades_garantias', 'salidas_alternativas', 'juicio', 'recursos',
      'ejecucion', 'otro'
    )),
  titulo          text NOT NULL,
  suma            text NOT NULL,
  cuando          text,
  base_normativa  text,
  cuerpo          text NOT NULL,
  claves          text,
  rol_sugerido    text NOT NULL DEFAULT 'ambos'
    CHECK (rol_sugerido IN ('defensor', 'querellante', 'ambos')),
  archivado       boolean NOT NULL DEFAULT false,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);

-- El único patrón de lectura: "los modelos vigentes de este abogado".
CREATE INDEX IF NOT EXISTS idx_modelos_escrito_usuario
  ON modelos_escrito (usuario_id, archivado, creado_en DESC);

COMMENT ON TABLE modelos_escrito IS
  'Modelos de escrito PROPIOS de cada abogado (origen abogado) o redactados por LEXIE a pedido (origen lexie). Los 50 modelos del estudio viven en src/lib/escritos/catalogo-estudio.ts, no acá.';

-- ============================================================
-- 4. escritos_generados — un escrito redactado para una causa
-- ============================================================
-- `modelo_id` es TEXT y no una FK: apunta a un slug del catálogo versionado
-- ("excarcelacion") o al UUID de `modelos_escrito`, y ninguna de las dos cosas
-- se puede referenciar con una FK. `modelo_titulo` es un snapshot del nombre
-- para que el historial se lea aunque el modelo se archive o se renombre.
--
-- `usuario_id` va REDUNDANTE con `casos.usuario_id` a propósito: el server
-- entra con service_role, que bypassa RLS, y el filtro `.eq("usuario_id")`
-- dentro de cada UPDATE/DELETE es el único control real de propiedad. Con la
-- columna acá ese filtro es un predicado y no un join.
--
-- `contenido` es markdown liviano (títulos con #, párrafos, **negritas**);
-- render.ts lo convierte a PDF. Persistir el texto y no el PDF es lo que hace
-- que corregir una coma no cueste otra generación.
CREATE TABLE IF NOT EXISTS escritos_generados (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caso_id         uuid NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
  usuario_id      uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  modelo_id       text,
  modelo_titulo   text NOT NULL,
  titulo          text NOT NULL,
  contenido       text NOT NULL,
  instrucciones   text,
  estado          text NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador', 'presentado')),
  presentado_en   timestamptz,
  ejecucion_id    uuid REFERENCES ejecuciones(id) ON DELETE SET NULL,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_escritos_generados_caso
  ON escritos_generados (caso_id, creado_en DESC);

COMMENT ON TABLE escritos_generados IS
  'Escritos redactados por el agente para una causa, a partir de un modelo. Se persiste el TEXTO; el PDF se genera a pedido. `modelo_id` es slug del catálogo o UUID de modelos_escrito.';

-- Mismo trigger de `actualizado_en` que el resto de las tablas con edición.
-- Se define la función si no existe (el repo tiene varias copias con nombres
-- distintos; ésta es propia para no depender de cuál está aplicada).
CREATE OR REPLACE FUNCTION escritos_set_actualizado_en()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS modelos_escrito_set_actualizado_en ON modelos_escrito;
CREATE TRIGGER modelos_escrito_set_actualizado_en
  BEFORE UPDATE ON modelos_escrito
  FOR EACH ROW EXECUTE FUNCTION escritos_set_actualizado_en();

DROP TRIGGER IF EXISTS escritos_generados_set_actualizado_en ON escritos_generados;
CREATE TRIGGER escritos_generados_set_actualizado_en
  BEFORE UPDATE ON escritos_generados
  FOR EACH ROW EXECUTE FUNCTION escritos_set_actualizado_en();

-- Sin trigger que bumpee casos.actualizado_en. Esa columna ordena el Inicio,
-- el buscador y el contexto de LEXIE: generar un BORRADOR no es actividad
-- procesal. Presentarlo sí lo es, y eso se registra como evento del caso
-- (eventos_caso ya tiene su trigger), no acá.

-- ============================================================
-- 5. ejecuciones.tipo — sumar 'generar_escrito'
-- ============================================================
-- Mismo patrón defensivo que 20260706190000 / 20260721120000 / 20260819120000:
-- el CHECK se borra POR DEFINICIÓN y se recrea con el set completo. Los seis
-- valores previos están en uso: ninguno se puede omitir.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'ejecuciones'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%tipo%'
  LOOP
    EXECUTE format('ALTER TABLE ejecuciones DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE ejecuciones ADD CONSTRAINT ejecuciones_tipo_check
  CHECK (tipo IN (
    'pre_analisis',
    'analizar_caso',
    'consulta_caso',
    'simular_mapa',
    'simular_audiencia',
    'lexie',
    'generar_escrito'
  ));

-- ============================================================
-- Hardening: deny-by-default y sin acceso desde los roles públicos
-- ============================================================
-- Consistente con la Fase 5.5. Son escritos con nombres reales de imputados y
-- el texto de lo que la defensa va a plantear: secreto profesional.
ALTER TABLE modelos_escrito ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON modelos_escrito FROM anon, authenticated;

ALTER TABLE escritos_generados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON escritos_generados FROM anon, authenticated;

-- ============================================================
-- Verificación (correr después)
-- ============================================================
-- 1) Las cuatro columnas nuevas de usuarios y la de partes:
-- SELECT table_name, column_name FROM information_schema.columns
-- WHERE (table_name = 'usuarios' AND column_name IN ('nombre_completo','matricula','domicilio_constituido','domicilio_electronico'))
--    OR (table_name = 'partes_caso' AND column_name = 'documento');
--
-- 2) Las dos tablas, cerradas a los roles públicos:
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('modelos_escrito','escritos_generados');
-- SELECT table_name, grantee FROM information_schema.role_table_grants
-- WHERE table_name IN ('modelos_escrito','escritos_generados');  -- sin anon ni authenticated
--
-- 3) El CHECK de ejecuciones con los 7 valores:
-- SELECT pg_get_constraintdef(con.oid) FROM pg_constraint con
-- JOIN pg_class rel ON rel.oid = con.conrelid
-- WHERE rel.relname = 'ejecuciones' AND con.contype = 'c' AND pg_get_constraintdef(con.oid) ILIKE '%tipo%';
