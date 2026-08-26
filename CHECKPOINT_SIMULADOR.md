# CHECKPOINT — Simulador de Audiencias (THÉMIS)

**Última sesión:** 2026-07-22 · **Estado:** backend + UI completos y pusheados. **Sin mergear, sin deployar, sin probar contra la API real.**

---

## Dónde quedó todo

| | Estado |
|---|---|
| Código | ✅ 17 commits en `feat/simulador-ui`, pusheados a GitHub |
| Migraciones | ✅ Las 2 aplicadas en Supabase por Mateo el 2026-07-22 |
| Merge a `main` | ❌ **Pendiente** — el PR no se abrió/mergeó |
| Deploy | ❌ **Pendiente** — servicio nuevo en Easypanel, sin tocar el legacy |
| Prueba real | ❌ **Nunca corrió una audiencia.** Cero llamadas a Anthropic |

### Ramas (stackeadas, las 3 en `origin`)

```
main (a138bd8)
 └─ feat/simulador-fundacion   3 commits   migración + tipos TS
     └─ feat/simulador-motor   8 commits   guion, esquemas, motor, rutas API
         └─ feat/simulador-ui  6 commits   UI completa   ← contiene TODO (17)
```

PR a abrir: https://github.com/mateomorbi19-maker/APPabogados/compare/main...feat/simulador-ui

---

## Lo primero que hay que hacer mañana

1. **Conseguir un caso PBA.** El simulador solo cubre CPP Buenos Aires (Ley 11.922) y bloquea cualquier otro fuero. El caso con el que se probó era **Federal** → pantalla de bloqueo.
   ```sql
   select id, titulo, fuero, creado_en from casos order by creado_en desc;
   ```
   Si no hay ninguno con `fuero='pba'`: crear uno nuevo desde **Nuevo análisis** (hay un relato de robo agravado en La Matanza listo para pegar, en el historial del chat), y **después entrar al Mapa procesal y confirmar el fuero PBA** — es la única acción de la app que setea `casos.fuero`.

2. **Correr una audiencia completa** en local (`npm run dev`) antes de deployar. Abrir → 2-3 intervenciones → cerrar y ver el informe.

3. **Evaluar el guion con ojo crítico** (esto es lo que decide si sigue el deploy o hay otra vuelta):
   - ¿Usa los hechos y la prueba REALES del expediente, o inventa un caso genérico?
   - ¿Cita solo los artículos de la lista cerrada del guion, o se manda con otros?
   - ¿Aparece alguna carátula de fallo? **No debería** — está prohibido explícitamente.
   - ¿Se corta a mitad de frase? (badge "Intervención cortada" en la UI)
   - ¿El informe evalúa lo que dijiste concretamente o tira generalidades?

4. Según cómo salga: ajustar `src/lib/simulador/guion-pp.md` (es solo editar el `.md`, no hay que tocar código) → mergear → deployar.

---

## Deploy (decidido: servicio NUEVO, legacy intacto)

Se descartó reemplazar el legacy de `lexstrategy.teotec.org`. El plan es un servicio Easypanel aparte con subdominio propio; si convence, después se apunta el dominio.

- Source GitHub, branch `main`, build **Dockerfile** (ya existe en la raíz, Fase 5.4 hecha), port `3000`.
- **Las 11 variables de entorno van en Build Args Y en Environment.** `env.ts` las valida en runtime y tira si falta una: el contenedor no arranca degradado, se cae.
- `NEXT_PUBLIC_SUPABASE_URL` = solo el host, sin `/rest/v1/` ni barra final (el schema lo rechaza).
- **Agregar el subdominio nuevo en el dashboard de Clerk**, o el login rompe con un error que parece del build.
- Verificado: el build de webpack (el que corre en el Docker) incluye el guion en `.next/standalone/src/lib/simulador/guion-pp.md`.

---

## Qué se construyó

**Backend** (`src/lib/simulador/`)
- `guion-pp.md` — el prompt de THÉMIS. **Borrador legal sin validar** (pendiente Dr. Gonzalo, checklist V-1..V-17). Está en `.md` aparte justo para poder reemplazarlo entero sin tocar código.
- `contexto.ts` — arma el system: guion + configuración + `buildContextoCaso` (reusado) + estrategia.
- `schemas.ts`, `labels.ts`, `queries.ts`, `run-simulacion.ts` (3 operaciones, un `messages.create` cada una, sin tools ni RAG).
- Rutas: `POST /api/casos/[id]/simulacion` · `.../[simId]/turno` · `.../[simId]/cerrar`.

**UI** (`src/components/simulador/` + `src/app/dashboard/simulador/[id]/`)
- Vista inmersiva full-height (patrón chat/mapa). Configuración → audiencia → informe.
- Transcript que separa por orador con color; envío optimista; informe con métricas y barras.
- Entrada desde el detalle del caso, tercera tarjeta con badge "Beta".

**Tablas** (ya en la DB): `simulaciones_audiencia`, `turnos_simulacion`, + `ejecuciones.tipo='simular_audiencia'`, + índice único de 1 audiencia en curso por caso.

---

## Limitaciones conocidas (decididas, no olvidos)

1. **Solo se ve la última audiencia.** Corrés una segunda y el informe de la primera no es accesible desde la UI. Los datos están en la DB:
   ```sql
   select id, dificultad, estado, debriefing from simulaciones_audiencia
    where caso_id = '...' order by creada_en desc;
   ```
   Fix pendiente: `searchParams` + dropdown, calcado del chat. **Es el candidato #1 para la próxima pasada.**
2. **No hay GET de turnos** → no se puede hacer recovery-polling como el chat. Ante un corte de proxy la UI bloquea el input y pide recargar (nunca invita a reenviar, que duplicaría turno y cobro).
3. **Sin streaming ni prompt caching.** Cada turno reenvía system + transcript completos a precio de input.
4. `abandonarEnCurso` + `crearSimulacion` no son atómicos, y no hay trigger que rechace turnos sobre sesiones cerradas. Ventana inalcanzable con 3 usuarios.
5. Un solo tipo de audiencia (`prision_preventiva`) y un solo fuero (PBA).

---

## Dos reviews adversariales ya corridas (no repetir)

- **Backend:** 7 confirmados, corregidos en `simulador 2.7`. El grave: `registrarEjecucion` se tragaba el error del insert → tokens cobrados que no entraban en el cupo mensual.
- **UI:** 9 confirmados, 7 corregidos en `simulador 3.6`. El grave: un corte de proxy borraba el turno optimista que el server **sí** había guardado → el reenvío duplicaba intervención y cobro.

---

## Contexto que no está en el código

- **CLAUDE.md tiene 6 afirmaciones desactualizadas** (documentadas en `AUDIT-HEARSIM.md` §7.3). La más peligrosa: dice que `analizar-caso` no fuerza el RAG con `tool_choice` — es falso, [run-agent.ts:207](src/lib/agent/run-agent.ts#L207) sí lo fuerza. También dice que falta el Dockerfile de raíz: ya existe.
- **El MCP de Supabase no sirve** en esta cuenta: el token está scopeado a otra organización y el proyecto `xvdlnevcvcsgxbngwliv` da *access denied*. Todo lo de DB se verifica con SQL que corre Mateo.
- **`gh` CLI no está instalado** → los PR se abren desde la web.
- Lección de esta sesión: la migración de fundación se creyó aplicada dos sesiones seguidas y no lo estaba. **Verificar contra la DB, no contra el archivo del repo.**
