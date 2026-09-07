# Instrucciones para agentes

**La fuente única de verdad de este repo es [CLAUDE.md](CLAUDE.md).** Ahí está el
stack, la estructura, cada API route, el schema de Supabase, el RAG y el estado
fase por fase. Empezá por ahí; para arrancar el entorno, por [README.md](README.md).

Este archivo existe solo porque algunas herramientas lo buscan por nombre en la
raíz. No duplica el inventario del repo a propósito: hasta septiembre de 2026
era una copia de `CLAUDE.md` congelada en la Fase 5.4, y lo que hacía era mentir
—daba el Dockerfile por inexistente, listaba 3 scripts de 25, y un reemplazo mal
hecho había dejado escrito un ID de modelo que no existe. Un inventario
duplicado que diverge es peor que ninguno.

## Antes de tocar nada

- **Commits en español**, prefijados por sub-paso (`"11.4: LEXIE crea, edita y
  elimina eventos de la agenda"`).
- **Stage explícito, archivo por archivo** (`git add path/a.tsx path/b.tsx`).
  Nunca `git add .`.
- **No pushear sin OK explícito** del dueño, y después de QA manual.
- **Nunca `--no-verify`** ni saltear hooks.

## Qué no se toca

- **`src/components/ui/`** son primitivas de shadcn: se regeneran con el CLI, no
  se editan a mano.
- **Tres módulos generados**, cada uno con su script y su fuente declarados en
  el encabezado del archivo: `src/lib/repositorio/catalogo.ts`,
  `src/lib/repositorio/catalogo-materias.ts` y
  `src/lib/escritos/catalogo-estudio.ts`. Para corregir uno, se edita la fuente
  y se vuelve a correr el script.
- **La tabla `documentos` de Supabase es inmutable** para esta app: es el vector
  store ya cargado y el corpus no es reproducible del todo desde el repo. Los
  ingestores de normativa (`scripts/ingestar-cp.ts`, `ingestar-cppf-html.ts`)
  son **destructivos**: no correrlos salvo que haya que recargar el corpus a
  propósito.
- **`notas-migracion/` jamás se commitea.** Está gitignoreada y tiene datos
  sensibles y workflows de n8n.
- **`legacy/`** es el sistema anterior, apagado. Queda como referencia
  histórica; no se lo mantiene ni se lo arregla.

## Reglas del código

- TypeScript strict siempre. Nunca hardcodear credenciales.
- Validar todo input con **Zod en el borde** de cada API route.
- **Color por token, nunca por literal.** Superficies, bordes y texto van por
  `var(--el-*)` o por las vars de shadcn. Un literal de Tailwind
  (`text-amber-400`) solo se acepta con su contraparte clara
  (`text-amber-700 dark:text-amber-400`). Excepción: mapa procesal y simulador,
  que corren siempre en oscuro y montan su propio `.dark`.
- **Formato es-AR:** números con `toLocaleString('es-AR')`, fechas
  `DD/MM/YYYY HH:MM`.
- El prompt al modelo **exige JSON puro**, sin markdown ni backticks. El parser
  igual limpia backticks a la defensiva.
- Ninguna migración se aplica por CLI: se corre a mano en el SQL Editor y se
  anota en [MIGRATION_LOG.md](MIGRATION_LOG.md). Ese archivo es la única prueba
  de qué está realmente aplicado en la base — un `.sql` versionado no prueba nada.
