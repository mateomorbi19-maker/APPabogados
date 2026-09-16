-- Fase 12 — Reportería al cliente.
--
-- ESTE ARCHIVO NO FUE EJECUTADO por Claude Code. Lo corre Mateo a mano en el
-- SQL Editor de Supabase (ver MIGRATION_LOG.md). Es idempotente: se puede
-- volver a correr sin romper nada.
--
-- Qué agrega, y por qué en UNA sola migración (mismo criterio que la Fase 9:
-- cada corrida manual es una ventana en la que el repo y la base no coinciden):
--
--   1. partes_caso.telefono / partes_caso.email — el contacto del cliente. La
--      P1 del documento de agosto («¿el reporte es por causa o por persona?»)
--      se contesta POR PERSONA (docs/PLAN_REPORTERIA.md §2), así que el
--      contacto cuelga de la parte y no de la causa.
--   2. reportes_cliente — un mensaje al cliente: lo que generó el sistema, lo
--      que finalmente salió, a quién, cuándo y por qué canal.
--   3. ejecuciones.tipo suma 'reporte_cliente'.
--   4. modelos_escrito.categoria suma 'extrajudicial' (Fase 13: los modelos de
--      Gonzalo traen cartas documento e intimaciones, que no son escritos
--      judiciales; el catálogo en código ya usa la categoría y sin esto un
--      modelo PROPIO con esa categoría no se podría guardar).
--
-- Acoplamiento código ↔ migración: MEDIO. `COLS_PARTE` incluye las dos columnas
-- nuevas, pero `listarPartes` / `leerParte` (src/lib/casos/escritura.ts)
-- detectan 42703 y reintentan con la lista vieja, así que los reads de partes
-- NO se rompen sin la migración: sólo pierden el contacto. Lo que sí necesita
-- la base —guardar un teléfono, generar o enviar un reporte— devuelve 503 con
-- un mensaje claro ANTES de gastar en el modelo.

-- ============================================================
-- 1. partes_caso — contacto
-- ============================================================
ALTER TABLE partes_caso
  ADD COLUMN IF NOT EXISTS telefono text,
  ADD COLUMN IF NOT EXISTS email    text;

COMMENT ON COLUMN partes_caso.telefono IS
  'Teléfono de contacto (texto libre, con prefijo si lo tiene). Sólo se usa para reportar al cliente; se muestra completo antes de marcar un envío por WhatsApp.';
COMMENT ON COLUMN partes_caso.email IS
  'Correo de contacto, en minúsculas. Es la dirección a la que sale un reporte por correo: se muestra completa antes de confirmar el envío.';

-- ============================================================
-- 2. reportes_cliente
-- ============================================================
-- `usuario_id` va REDUNDANTE con `casos.usuario_id` a propósito, igual que en
-- escritos_generados: el server entra con service_role (bypassa RLS) y el
-- `.eq("usuario_id")` dentro de cada UPDATE es el único control real.
--
-- `parte_id` es SET NULL al borrar la persona: el reporte ya salió y tiene que
-- quedar el registro de a quién se le mandó, por eso `destinatario_nombre` y
-- `enviado_a` se copian en la fila y no se resuelven por join.
--
-- Dos textos, a propósito (P4 del documento de agosto): `contenido_generado`
-- es lo que produjo el sistema y no se toca; `contenido` es lo que el abogado
-- edita; `contenido_enviado` es lo que salió. La diferencia entre el primero
-- y el último es la mejor señal de qué plantilla está fallando.
CREATE TABLE IF NOT EXISTS reportes_cliente (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caso_id              uuid NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
  usuario_id           uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  parte_id             uuid REFERENCES partes_caso(id) ON DELETE SET NULL,
  destinatario_nombre  text NOT NULL,
  plantilla            text NOT NULL
    CHECK (plantilla IN ('P01', 'P02', 'P03', 'P04', 'P05', 'P06')),
  variante             text,
  canal                text NOT NULL DEFAULT 'copia'
    CHECK (canal IN ('email', 'whatsapp', 'copia')),
  estado               text NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador', 'enviado', 'descartado')),
  asunto               text,
  contenido_generado   text NOT NULL,
  contenido            text NOT NULL,
  contenido_enviado    text,
  -- Lo que el abogado tipeó en el formulario (criterio profesional) y el
  -- esqueleto de datos que el sistema armó. Son el «cómo se llegó a este
  -- texto»: sin ellos, un reporte de hace tres meses no se puede auditar.
  criterio             jsonb NOT NULL DEFAULT '{}'::jsonb,
  datos                jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- true cuando la variante no pasa por el modelo (prisión preventiva,
  -- condena): el cuerpo lo escribe el abogado.
  sin_ia               boolean NOT NULL DEFAULT false,
  enviado_en           timestamptz,
  -- La dirección de correo o el teléfono EXACTOS a los que salió.
  enviado_a            text,
  gmail_message_id     text,
  ejecucion_id         uuid REFERENCES ejecuciones(id) ON DELETE SET NULL,
  creado_en            timestamptz NOT NULL DEFAULT now(),
  actualizado_en       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reportes_cliente_caso
  ON reportes_cliente (caso_id, creado_en DESC);

-- La tarjeta del Inicio («clientes sin novedades») pregunta por el último
-- envío de cada causa del abogado: índice parcial sobre lo enviado.
CREATE INDEX IF NOT EXISTS idx_reportes_cliente_enviados
  ON reportes_cliente (usuario_id, caso_id, enviado_en DESC)
  WHERE estado = 'enviado';

COMMENT ON TABLE reportes_cliente IS
  'Mensajes del abogado a su cliente sobre el estado de la causa (Fase 12). Se guarda lo generado, lo editado y lo efectivamente enviado. Nunca sale nada sin que el abogado lo lea y confirme.';

CREATE OR REPLACE FUNCTION reportes_set_actualizado_en()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS reportes_cliente_set_actualizado_en ON reportes_cliente;
CREATE TRIGGER reportes_cliente_set_actualizado_en
  BEFORE UPDATE ON reportes_cliente
  FOR EACH ROW EXECUTE FUNCTION reportes_set_actualizado_en();

-- Sin trigger sobre casos.actualizado_en ni evento del timeline: reportarle al
-- cliente no es un acto del expediente (docs/PLAN_REPORTERIA.md §3.5).

-- ============================================================
-- 3. ejecuciones.tipo — sumar 'reporte_cliente'
-- ============================================================
-- Mismo patrón defensivo que 20260904120000: el CHECK se borra por definición
-- y se recrea con el set completo. Los siete valores previos están en uso.
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
    'generar_escrito',
    'reporte_cliente'
  ));

-- ============================================================
-- 4. modelos_escrito.categoria — sumar 'extrajudicial'
-- ============================================================
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'modelos_escrito'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%categoria%'
  LOOP
    EXECUTE format('ALTER TABLE modelos_escrito DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE modelos_escrito ADD CONSTRAINT modelos_escrito_categoria_check
  CHECK (categoria IN (
    'actos_iniciales',
    'libertad_coercion',
    'prueba',
    'victima_querella',
    'nulidades_garantias',
    'salidas_alternativas',
    'juicio',
    'recursos',
    'ejecucion',
    'extrajudicial',
    'otro'
  ));

-- ============================================================
-- Hardening: deny-by-default y sin acceso desde los roles públicos
-- ============================================================
-- Vale doble acá: son mensajes con la estrategia de la defensa explicada en
-- lenguaje llano, y el contacto personal de los clientes.
ALTER TABLE reportes_cliente ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON reportes_cliente FROM anon, authenticated;

-- ============================================================
-- Verificación (correr después)
-- ============================================================
-- 1) Las dos columnas de contacto:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'partes_caso' AND column_name IN ('telefono', 'email');   -- 2 filas
--
-- 2) La tabla, cerrada a los roles públicos:
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'reportes_cliente';  -- t
-- SELECT grantee FROM information_schema.role_table_grants
-- WHERE table_name = 'reportes_cliente';  -- sin anon ni authenticated
--
-- 3) Los dos CHECK ampliados:
-- SELECT pg_get_constraintdef(con.oid) FROM pg_constraint con
-- JOIN pg_class rel ON rel.oid = con.conrelid
-- WHERE rel.relname IN ('ejecuciones', 'modelos_escrito') AND con.contype = 'c';
--
-- 4) Desde el repo, gratis y de solo lectura:
-- DOTENV_CONFIG_PATH=.env.local npx tsx --conditions=react-server --import dotenv/config scripts/verificar-reporteria.ts --sin-modelo
