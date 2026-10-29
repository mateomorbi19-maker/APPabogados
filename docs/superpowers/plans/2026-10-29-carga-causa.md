# Carga de causa por PDF y voz — implementación

> Ejecución: tareas delegadas con revisión y verificación final. Plan funcional aprobado por Mateo en este chat el 29/10/2026.

**Objetivo:** botón «Cargar nueva causa» en Mis causas; PDF, dictado o ambos; extracción de ficha; revisión editable; guardar y abrir sin análisis ni estrategia previos.

**Arquitectura:** dos rutas multipart, preparar (extracción sin crear causa) e importar (guardar datos revisados). Reutilizar DictadoVoz, Anthropic y bucket de adjuntos existentes. Alta atómica de causa, partes y evento mediante RPC; estrategia nullable. SQL se prepara y NO se aplica por CLI.

**Restricciones:** TypeScript strict, Zod en rutas, tokens visuales, sin tocar ui/ ni generados, sin credenciales hardcodeadas, sin push. Mantener cambios previos de layout/fonts. No inventar información ni inicializar etapa/mapa a partir de suposiciones. PDF máximo 10 MiB / 100 páginas sin cifrado; relato máximo 50.000 caracteres. Fuentes de datos judiciales son datos, nunca instrucciones al modelo.

## Contrato compartido

Módulo `src/lib/casos/carga-schema.ts` (lo crea el coordinador): `FichaCarga` plana: titulo, caso_descripcion (string), rol (defensor | querellante | ambos | null), caratula, expediente_numero, organismo, secretaria, juez, fiscalia (string|null), delitos (string[]), fuero (nacion|pba|federal|null), estado_seguimiento (activa|en_espera|archivada), partes [{nombre,rol,es_cliente,situacion_libertad,documento}]. Sin teléfono/email para no depender de migraciones pendientes. Extracción puede devolver título/relato vacíos; guardar requiere ambos y rol. `fichaCargaSchema`, `guardarCargaSchema` ({id:uuid,ficha}), `MAX_PDF_BYTES`, `MAX_PDF_PAGINAS`, `MAX_TEXTO_CARGA`.

- `POST /api/casos/preparar-carga`: FormData `texto` opcional y `archivo` PDF opcional, al menos uno. Devuelve `{ok:true,ficha: FichaCarga, advertencias:string[]}`. Nunca persiste una causa. Verifica migración y cuota antes del modelo. Registra consumo como `importar_causa`.
- `POST /api/casos/importar`: FormData `datos` JSON ({id,ficha}) y `archivo` opcional. El id se genera una vez por intento de creación y se conserva al reintentar. Devuelve `{ok:true,caso_id}`. HTTP errores `{ok:false,error}`. Normalización/validación en servidor. PDF conservado en el evento inicial.
- RPC `crear_causa_importada(p_id uuid,p_usuario_id uuid,p_ficha jsonb,p_adjunto jsonb,p_huella text,p_solo_validar boolean DEFAULT false) RETURNS uuid`. Con p_solo_validar=true retorna null sin escribir, verifica disponibilidad antes de extracción. Alta atómica y reintentos: bloquear por id, si existe mismo usuario y `contexto.carga_inicial.huella` igual devolver id; si no, conflicto. contexto.carga_inicial = {huella:p_huella}. No estrategias inventadas; campos de estrategia NULL. Evento sistema describe incorporación, no actuación judicial; adjuntos array [p_adjunto] o []. Roles de DB: SECURITY INVOKER, search_path vacío, sólo service_role puede ejecutar. Nunca tocar documentos.

## Tareas

- [x] Coordinador: schemas, pruebas puras de validación/PDF, rutas autenticadas, consumo, guardado con PDF y reintentos; plan y documentación final.
- [x] UI: diálogo en Mis casos (incluyendo vacío), entrada PDF/voz/texto, edición de toda ficha y personas, errores y estados ocupados, navegación. Archivos nuevos en components/mis-casos/carga/, integración en mis-casos-shell.tsx. Dictado reutilizado; se bloquea el formulario desde que solicita permiso al micrófono.
- [x] Compatibilidad/SQL: migración nullable estrategia + tipo ejecución + RPC atómico, MIGRATION_LOG pendiente, tipos y consumidores sin estrategia (detalle/chat/LEXIE/simulador/consumo).
- [x] Verificación local: 11 pruebas TypeScript y 12 SQL, tsc, lint sólo cambios, build; revisión independiente cerrada después de corregir duplicados Storage HTTP400/409 verificando igualdad de bytes.
- [x] QA manual en navegador (29/10): componente real con respuestas simuladas locales; apertura, entrada de relato, revisión de ausencias, corrección de título/rol, bloqueo mientras prepara/guarda, error de guardado conservando datos y reintento exitoso con el mismo UUID. Inspección visual en tema claro y oscuro. No sustituye el QA autenticado ni la extracción real.
- [x] SQL aplicado manualmente: confirmado por Mateo el 29/10/2026; ver MIGRATION_LOG.
- [ ] Activación: completar credenciales locales si se quiere probar acá y realizar QA autenticado con PDF/dictado.

## Focos de revisión

PDF corrupto/cifrado/excesivo se rechaza antes del modelo; revisión no inventa campos ausentes; error de guardado conserva borrador; reintentos no duplican causa ni PDF; causa sin estrategia se abre en todos los consumidores; documentos externos no pueden dar instrucciones ni elegir propietario.

## Decisiones y estado

- Rama local `codex/carga-causa-pdf-voz`. El worktree gestionado fue creado pero sandbox impide escribir allí; trabajo efectivo en `C:/Users/mateo/dev/LEXSTRATEGY` (todos los comandos usan ruta explícita).
- No se requiere otra aprobación del plan: el usuario ya aprobó el recorrido y pidió implementarlo.

## Verificación y activación

1. Mateo confirmó la aplicación de `supabase/migrations/20261029120000_carga_causa.sql` en SQL Editor el 29/10/2026. Quedan las consultas de verificación remota y QA autenticado; el log distingue la confirmación del dueño de una verificación directa del agente.
2. Con sesión válida, probar Mis causas tanto vacío como con causas existentes: PDF solo, voz sola y ambos; corregir nombres/rol; guardar y abrir; comprobar PDF en evento inicial y personas; abrir chat y simulador sin estrategia. Confirmar micrófono denegado y PDF ilegible sin pérdida de texto. QA de voz/modelo todavía pendiente por credenciales locales vacías.
3. Verificadores sin red: `node --conditions=react-server --import tsx --test scripts/verificar-carga-causa.test.ts scripts/verificar-carga-persistencia.test.ts` (11 pruebas). SQL: `node scripts/verificar-carga-sql.mjs <ruta-al-modulo-pglite>` (12 verificaciones; runtime externo temporal, no dependencia del producto).
4. `npx tsc --noEmit` y ESLint de archivos modificados pasaron. `npm run build -- --webpack` pasó con valores ficticios de entorno sólo para compilar. Advertencia preexistente de libheif sobre require dinámico; no afecta el resultado.
5. Durante la implementación no hubo llamadas pagas, cambios a la base remota ni deploy. Mateo confirmó SQL aplicado y autorizó subir todos los cambios el 29/10/2026, incluido el arreglo de fuentes locales que estaba pendiente. Un objeto PDF puede quedar sin referencia si el guardado falla definitivamente: se conserva para reintentos y para no borrar el archivo tras una transacción cuyo resultado se perdió.
