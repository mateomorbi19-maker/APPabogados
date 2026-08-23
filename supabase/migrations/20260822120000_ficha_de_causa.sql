-- F1 — Ficha de causa: la identidad del expediente.
--
-- ESTE ARCHIVO NO FUE EJECUTADO por Claude Code. Lo corre Mateo a mano en el
-- SQL Editor de Supabase (ver MIGRATION_LOG.md).
--
-- Por qué esta migración va SOLA, antes de una línea de TypeScript: no hay un
-- solo `select("*")` sobre `casos` en todo el repo — son 13 call sites que
-- enumeran columnas a mano. Una columna nombrada en un SELECT que la base no
-- tiene devuelve 42703 y PostgREST lo traduce a 500 en TODOS los reads del
-- caso. Ya pasó exacto con `riesgo_alto` del mapa (PLAN_MAPA_PROCESAL.md).
--
-- Y va UNA sola migración y no cuatro chicas por el motivo contrario al que
-- parece: cada corrida manual es una ventana en la que el repo y la base no
-- coinciden, y el drift de este proyecto corta para los dos lados (al
-- 2026-08-22, MIGRATION_LOG daba por pendientes dos migraciones que estaban
-- aplicadas hace semanas). Menos corridas, menos ventanas.
--
-- ============================================================
-- Qué problema resuelve
-- ============================================================
-- Hoy la app conoce la HISTORIA de una causa (el relato, la estrategia
-- elegida, el mapa procesal, los eventos) y no conoce su IDENTIDAD. Medido
-- contra la base el 2026-08-22: de 8 causas, 4 se llaman con un pedazo del
-- relato — una es literalmente "El 3 de julio de 2026, cerca de las 04:15".
-- Eso degrada la lista de causas, el buscador global, el contexto de LEXIE y
-- el header del chat, todos a la vez, porque los cuatro leen `casos.titulo`.
--
-- REPORTERIA_AL_CLIENTE_PARA_DECIDIR.md §6 ya había fijado el orden: la ficha
-- va primero, y sirve aunque la reportería no se construya nunca.

-- ============================================================
-- casos — las columnas de identificación
-- ============================================================
-- Todas nullable salvo `estado_seguimiento`. Es deliberado y es el pedido
-- explícito del producto: el campo que falta se muestra VACÍO con opción de
-- cargarlo, nunca relleno con un valor verosímil. Es la misma regla que ya
-- rige para la jurisprudencia (SIN_JURISPRUDENCIA_APLICABLE) y la contraria a
-- la del simulador, que sí inventa un dato entre corchetes — son superficies
-- distintas: una es práctica interna, la otra sale firmada por el abogado.
--
-- Notas de modelo, campo por campo:
--
--   caratula          El nombre oficial ("Rodríguez, Carlos s/ defraudación").
--                     NO pisa `titulo`: conviven. `titulo` queda como el
--                     nombre de trabajo que puso el abogado al crear la causa
--                     (hoy, los primeros 60 chars del relato) y la carátula
--                     manda cuando existe, vía el helper nombreCaso(). Pisar
--                     `titulo` cambiaría de golpe lo que el abogado ya
--                     reconoce en la lista, en la agenda y en el buscador, y
--                     sin PATCH previo no habría forma de volver atrás.
--
--   expediente_numero text libre y no un formato validado, porque no hay UNO:
--                     Nación usa "12345/2024", PBA una IPP tipo
--                     "08-00-012345-26", y en varios organismos convive el
--                     CUIJ. Un CHECK acá sería una regla inventada por el
--                     sistema que el abogado tendría que pelear. El año va
--                     ADENTRO del número en los tres fueros: no se desdobla
--                     en una columna aparte, que serían dos verdades para el
--                     mismo dato desde el día uno.
--
--   organismo         Juzgado, tribunal o fiscalía donde tramita. Se llama
--                     `organismo` y no `juzgado` porque en PBA la causa vive
--                     en una UFI antes de estar en un Juzgado de Garantías, y
--                     después de la elevación pasa a un Tribunal Oral: los
--                     tres son el mismo campo conceptual.
--
--   secretaria        Subdivisión interna del organismo. Va aparte de
--                     `organismo` porque es el dato con el que se pregunta por
--                     teléfono, y en el mockup ocupa su propio renglón.
--
--   juez              Nombre. Sin FK a ninguna tabla de magistrados: no
--                     existe, y para 3 abogados un catálogo de jueces es una
--                     tabla que hay que mantener a mano para ahorrar tipear.
--
--   fiscalia          Fiscal + dependencia en un solo campo ("Dra. Benítez —
--                     UFI Delitos Económicos"), que es como se escribe y como
--                     lo muestra el mockup. Desdoblarlo obliga a dos inputs
--                     para un dato que nadie consulta por separado.
--
--   delitos           text[] y no text: una causa real casi nunca tiene un
--                     solo delito, y en array el buscador puede pegarle a uno
--                     sin depender de cómo se separaron con comas. El UI los
--                     muestra como chips.
--
--   estado_seguimiento El estado de la causa PARA EL ESTUDIO, que no es la
--                     etapa procesal. En el mockup son los dos badges de
--                     arriba y es fácil confundirlos: "Instrucción" es etapa
--                     (la deriva el mapa, ver abajo), "En seguimiento" es
--                     esto. Único NOT NULL, con default, para que las 8 causas
--                     que ya existen queden 'activa' sin backfill.
--
-- Lo que a propósito NO se agrega:
--
--   portal            (PJN / MEV / SIMP). Es derivable del `fuero` que ya
--                     existe. Como columna con CHECK obligaría a otra
--                     migración a mano cada vez que cambie el vocabulario.
--
--   etapa             La calcula el mapa procesal y no se persiste acá. El
--                     mapa ya deriva las 6 macro-etapas (ETAPA_LABEL) del nodo
--                     `ocurrido` más profundo, y la regla R5 de coherencia
--                     garantiza que esa línea no tiene agujeros. Una columna
--                     declarada a mano se contradiría con el mapa el primer
--                     día, y habría que decidir quién manda.
--
--   índices           Ninguno sobre `casos`. Son 8 filas y 3 usuarios: el
--                     planner los ignora y cada índice es superficie que
--                     mantener.

ALTER TABLE casos
  ADD COLUMN IF NOT EXISTS caratula          text,
  ADD COLUMN IF NOT EXISTS expediente_numero text,
  ADD COLUMN IF NOT EXISTS organismo         text,
  ADD COLUMN IF NOT EXISTS secretaria        text,
  ADD COLUMN IF NOT EXISTS juez              text,
  ADD COLUMN IF NOT EXISTS fiscalia          text,
  ADD COLUMN IF NOT EXISTS delitos           text[],
  ADD COLUMN IF NOT EXISTS estado_seguimiento text NOT NULL DEFAULT 'activa';

-- Mismo patrón defensivo que 20260706190000 / 20260721120000 / 20260819120000:
-- el CHECK se borra POR DEFINICIÓN y no por nombre (el nombre puede diferir
-- del default por el drift repo↔DB) y se recrea. Idempotente.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'casos'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%estado_seguimiento%'
  LOOP
    EXECUTE format('ALTER TABLE casos DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE casos ADD CONSTRAINT casos_estado_seguimiento_check
  CHECK (estado_seguimiento IN ('activa', 'en_espera', 'archivada'));

COMMENT ON COLUMN casos.caratula IS
  'Nombre oficial del expediente. NULL mientras el abogado no lo cargue; el UI muestra el campo vacío con opción de completarlo. Cuando existe, manda sobre `titulo` (helper nombreCaso).';
COMMENT ON COLUMN casos.expediente_numero IS
  'Texto libre: el formato difiere por fuero (12345/2024 en Nación, IPP 08-00-012345-26 en PBA, CUIJ). El año va adentro del número, no en columna aparte.';
COMMENT ON COLUMN casos.organismo IS
  'Juzgado, tribunal o fiscalía donde tramita. Se llama organismo y no juzgado porque la causa cambia de tipo de organismo a lo largo del proceso.';
COMMENT ON COLUMN casos.estado_seguimiento IS
  'Estado de la causa PARA EL ESTUDIO (activa|en_espera|archivada). NO es la etapa procesal: esa la deriva el mapa procesal y no se persiste.';

-- ============================================================
-- partes_caso — las personas de la causa
-- ============================================================
-- Tabla 1:N y no un campo de texto `imputados` en `casos`, por dos razones
-- concretas y una que no cuenta:
--
--   1. El imputado NO es siempre el cliente. Si el estudio actúa como
--      querellante, el cliente es la víctima y el imputado es la contraparte.
--      Un solo campo de texto no puede expresar eso, y es exactamente la
--      distinción que la reportería al cliente va a necesitar para no mandarle
--      la estrategia de defensa a la persona equivocada.
--   2. El buscador global tiene que poder devolver "Juan Pérez — imputado" y
--      decir POR QUÉ apareció. Con los nombres embebidos en un text plano el
--      match existe pero no se puede etiquetar.
--
-- La que NO cuenta: "esperar a que se conteste la P1 de REPORTERIA (¿el
-- reporte es por causa o por persona?)". La cardinalidad 1:N funciona igual
-- con las dos respuestas posibles, así que la tabla no es una apuesta. Lo que
-- SÍ es una apuesta son las columnas de contacto (teléfono, email, dirección,
-- "es el destinatario del reporte"), y por eso NO están acá. Se agregan cuando
-- Gonzalo y Lautaro contesten, en una migración de una línea.

CREATE TABLE IF NOT EXISTS partes_caso (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caso_id   uuid NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
  nombre    text NOT NULL,
  -- 'otro' existe para no bloquear la carga cuando el rol procesal no entra en
  -- la lista (un tercero citado, un perito de parte). Preferimos un valor de
  -- escape a que el abogado no cargue a la persona.
  rol       text NOT NULL DEFAULT 'imputado'
    CHECK (rol IN ('imputado', 'victima', 'querellante', 'denunciante', 'testigo', 'otro')),
  -- Marca de "nuestro cliente". Es un boolean y no un rol más porque es
  -- ORTOGONAL al rol procesal: nuestro cliente puede ser el imputado (defensa)
  -- o la víctima (querella). Sin unique parcial: una causa puede tener dos
  -- clientes (dos imputados del mismo estudio), y si tienen intereses
  -- contrapuestos eso es un problema de secreto profesional que decide el
  -- abogado, no un constraint.
  es_cliente boolean NOT NULL DEFAULT false,
  -- Solo tiene sentido para imputados; nullable para el resto. No hay CHECK
  -- cruzado con `rol` a propósito: durante la carga el abogado puede tipear en
  -- cualquier orden y un constraint cruzado rechazaría estados intermedios
  -- legítimos.
  situacion_libertad text
    CHECK (situacion_libertad IS NULL OR situacion_libertad IN (
      'libre',
      'detenido',
      'prision_preventiva',
      'prision_domiciliaria',
      'excarcelado'
    )),
  creado_en timestamptz NOT NULL DEFAULT now()
);

-- El único patrón de acceso de esta tabla es "las partes de esta causa".
-- No es un índice especulativo: es su única vía de lectura y la del CASCADE.
CREATE INDEX IF NOT EXISTS idx_partes_caso_caso
  ON partes_caso (caso_id, creado_en ASC);

COMMENT ON TABLE partes_caso IS
  'Personas de una causa. `es_cliente` es ortogonal a `rol`: nuestro cliente puede ser el imputado (defensa) o la víctima (querella). Sin datos de contacto hasta que se conteste la P1 de REPORTERIA_AL_CLIENTE_PARA_DECIDIR.md.';

-- Sin trigger que bumpee casos.actualizado_en (a diferencia de eventos_caso).
-- Esa columna ordena la lista del Inicio, el buscador y el contexto de LEXIE, y
-- significa "última actividad de la causa". Cargar una parte es alta de datos,
-- no actividad procesal: no debería saltear la causa al tope de la lista.

-- Hardening consistente con la Fase 5.5 y con 20260819120000: deny-by-default
-- y sin acceso desde los roles públicos. El server entra siempre con la
-- service_role key, que bypassa RLS; esto cierra la puerta de PostgREST.
-- Vale doble en esta tabla: son nombres reales de clientes e imputados.
ALTER TABLE partes_caso ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON partes_caso FROM anon, authenticated;

-- ============================================================
-- Verificación (correr después)
-- ============================================================
-- 1) Las 8 columnas nuevas de casos, y ninguna causa sin estado:
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'casos'
--   AND column_name IN ('caratula','expediente_numero','organismo','secretaria',
--                       'juez','fiscalia','delitos','estado_seguimiento')
-- ORDER BY column_name;
--
-- SELECT estado_seguimiento, count(*) FROM casos GROUP BY 1;  -- activa | 8
--
-- 2) La tabla nueva existe y está cerrada a los roles públicos:
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'partes_caso';  -- t
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
-- WHERE table_name = 'partes_caso';  -- no debe aparecer anon ni authenticated
