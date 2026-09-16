# Documentación archivada

Planes, auditorías y briefings de fases que ya se cerraron. Se conservan porque
explican **por qué** las cosas están como están —decisiones, alternativas
descartadas, mediciones contra la base— que no queda registrado en el código ni
en los commits.

> **Leelos con la fecha puesta.** Casi todos describen el repo del día en que se
> escribieron, no el de hoy. Varios afirman cosas que ya dejaron de ser ciertas;
> abajo se marca cuál y en qué. Para el estado actual, la fuente es
> [CLAUDE.md](../CLAUDE.md).

Sus links a `../src/...` apuntan al repo de la época: algunos ya estaban rotos
antes de archivarlos y se dejaron así a propósito, porque arreglarlos sería
falsificar el registro.

## Vigente

| Documento | Qué es |
|---|---|
| [PLAN_REPORTERIA.md](PLAN_REPORTERIA.md) | **Lo que hay que leer primero sobre reportería.** Plan de la Fase 12 (15/9/2026): qué se construyó, y sobre todo su **§2, que contesta por defecto las seis preguntas** que los socios nunca respondieron, con dónde se cambia cada una. Su §3 son las reglas duras (nada sale sin que un abogado lo lea, el hueco visible en vez del dato verosímil, la promesa de recurso sale de una decisión y no de la plantilla). |
| [PLAN_MODELOS_GONZALO.md](PLAN_MODELOS_GONZALO.md) | Fase 13 (15/9/2026): los 89 escritos reales que Gonzalo compartió por Drive, cómo se anonimizaron y clasificaron, y por qué el catálogo se partió en dos módulos. Su §6 es lo que todavía tiene que revisar un abogado. |
| [REPORTERIA_AL_CLIENTE_PARA_DECIDIR.md](REPORTERIA_AL_CLIENTE_PARA_DECIDIR.md) (+ [.pdf](REPORTERIA_AL_CLIENTE_PARA_DECIDIR.pdf)) | Documento del 12/8/2026 para Gonzalo y Lautaro: qué se puede hacer, qué hay que sacar, las 35 variables clasificadas por disponibilidad, y la conclusión de empezar por la ficha de causa antes que por las plantillas. **Sus 6 preguntas ya no bloquean nada**: las contesta el §2 del plan de arriba, por defecto y de forma reversible. Vale por el análisis, que sigue siendo el fundamento de las decisiones. El PDF es la exportación para mandar fuera del repo: si cambia el `.md`, regeneralo. |

## Planes de fases ya ejecutadas

| Documento | Qué sobrevive | Ojo con |
|---|---|---|
| [PLAN_LEXIE_ACCIONES.md](PLAN_LEXIE_ACCIONES.md) | Plan del 5/9/2026 para que LEXIE pase de leer a actuar sobre correo, agenda, escritos y ficha. Vale por el **porqué**: qué queda afuera, qué se confirma con botón, por qué no hay tool que inserte en `casos`. | El estado por sub-paso vive en CLAUDE.md, no acá. |
| [PLAN_FICHA_CAUSA.md](PLAN_FICHA_CAUSA.md) | Plan del 22/8/2026 de la identidad de la causa (carátula, expediente, organismo, juez, fiscalía, partes). Su §8 compara lo planeado con lo construido. Buena regla que dejó: verificar por PostgREST antes de tocar TypeScript. | — |
| [PLAN_MAPA_PROCESAL.md](PLAN_MAPA_PROCESAL.md) | Mapa procesal por fuero (Nación / PBA / Federal). Su **§6, las reglas de congruencia que restringen a la IA**, sigue siendo normativa. | Su §8 tiene **pendientes que siguen abiertos**: ingestar el CPPN y el CPP BA al RAG, y que un experto valide las 3 plantillas. |
| [BRIEFING_DISENO_MAPA_PROCESAL.md](BRIEFING_DISENO_MAPA_PROCESAL.md) | El rediseño ya se hizo (mapa v3). Lo que sirve es el **apéndice de 10 invariantes visuales** —precedencia de estados, rojo solo para desenlaces adversos, conexiones nunca grises— como checklist para no romper la semántica en un retoque futuro. | — |

## Auditorías

| Documento | Qué sobrevive | Ojo con |
|---|---|---|
| [AUDIT-HEARSIM.md](AUDIT-HEARSIM.md) | Auditoría del 21/7/2026 que midió si el repo tenía datos para construir el simulador: 110 campos en tres capas. Fundó el simulador. Se conserva sobre todo por su **§7.3, que lista 6 contradicciones de CLAUDE.md** — y **nadie verificó todavía si siguen vigentes**. | Sus huecos principales ya se taparon: la Fase 9 creó carátula/expediente/organismo/juez/partes, y la Fase 8 sumó el repositorio con RAG de jurisprudencia. |
| [AUDITORIA_CHAT_IA_2026-07-14.md](AUDITORIA_CHAT_IA_2026-07-14.md) | Auditoría multiagente del chat por caso con datos reales de la base. Cerrada: los P0/P1 se resolvieron (fix A-1, fix de costo A-3, envío optimista, prompt caching). | Como retrato del chat quedó vieja: después llegaron el motor genérico, LEXIE y los escritos. |
| [AUDITORIA_2026-05-07.md](AUDITORIA_2026-05-07.md) | La más vieja. Solo vale como línea de base histórica. | **Describe una app que ya no existe**: 27 ejecuciones, cero casos, sin agenda, mapa, simulador, repositorio, LEXIE, ficha ni escritos. Sus 3 críticos se resolvieron y sus 5 preguntas quedaron contestadas por los hechos. |

## Notas de sesión

| Documento | Qué sobrevive | Ojo con |
|---|---|---|
| [CHECKPOINT_SIMULADOR.md](CHECKPOINT_SIMULADOR.md) | Cierre de sesión del 22/7/2026 sobre el simulador de audiencias. Valen las **limitaciones decididas** (solo se ve la última audiencia, sin GET de turnos, sin streaming ni caching, un solo fuero y tipo de audiencia) y el pendiente de que **Gonzalo valide `guion-pp.md`** — nada de eso está reflejado en CLAUDE.md. | **Su afirmación central es falsa hoy**: dice "sin mergear", y los PR #38 y #39 se mergearon ese mismo día. |
| [INSTRUCCION_FABLE_CHAT_SESION1.md](INSTRUCCION_FABLE_CHAT_SESION1.md) | Encargo de una sola sesión sobre el chat (selector de modelo, layout inmersivo, adjuntos, audio, bug A-1). Ya consumido: todo se shippeó. | Envejeció mal en un punto concreto: **los IDs y los precios de modelos que pedía confirmar ya no son los actuales**. No lo uses como referencia de modelos. |
