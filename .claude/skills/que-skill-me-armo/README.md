# Qué skill me armo

Una skill para Claude Code que te ayuda a descubrir **qué skills te conviene armar a vos**,
mirando cómo trabajás de verdad.

No escribe la skill final. Hace el paso de antes, que es el que casi nadie hace: **lee lo que ya
le venís pidiendo a Claude Code**, encuentra los procesos que repetís de verdad y te los ordena
por lo que te devuelven. Después te dice cuáles **no** conviene armar, que es la mitad del valor.

Lo bueno de leer el historial es que no depende de tu memoria. Vos te acordás de lo que hiciste
ayer; el archivo se acuerda de las 400 veces que pediste lo mismo.

## Instalarla

Copiá la carpeta `que-skill-me-armo` adentro de:

- **Solo para un proyecto:** `.claude/skills/` de ese proyecto
- **Para todos tus proyectos:** `~/.claude/skills/` (en Windows: `C:\Users\TU-USUARIO\.claude\skills\`)

Abrís Claude Code y escribís `/que-skill-me-armo`, o directamente:

> no sé qué automatizar, ¿qué skill me armo?

## Antes de instalarla: leela

Es la regla que va con cualquier skill que bajes, incluida esta.

Una skill puede traer comandos que se ejecutan en tu máquina **antes de que Claude vea nada**.
Por eso, con cualquiera que bajes:

1. **Abrila y leela.** Son archivos de texto, se leen.
2. Buscá líneas que empiecen con `!` — sobre todo si dicen `curl`, `wget` o `.env`.
3. Mirá si tiene `allowed-tools` en el encabezado. `Bash(*)` es permiso para todo.

**Esta no tiene nada de eso:** ni comandos que se ejecuten solos, ni permisos especiales.
Trae **un solo script**, `escanear.py`, y hace exactamente esto: abre el archivo donde Claude
Code guarda tus pedidos, cuenta cuáles se repiten y los muestra en pantalla. No se conecta a
internet, no manda nada a ningún lado y no escribe ni borra un solo archivo tuyo. Son 200
líneas comentadas en castellano: leelas antes de correrlo, para eso están.

## Qué hay adentro

| Archivo | Qué es |
|---|---|
| `SKILL.md` | El proceso: cómo encuentra tus procesos y cómo los ordena |
| `escanear.py` | Lee tu historial local y cuenta qué le pedís más seguido |
| `PREGUNTAS.md` | Las seis preguntas, para cuando no hay historial o para completar |
| `CATEGORIAS.md` | El mapa: skill / automatización / todavía no / no vale la pena |
| `PLANTILLA.md` | Cómo queda la ficha y cómo se escribe una descripción que se active |

### El escáner, si lo querés correr suelto

```bash
python escanear.py               # todo tu historial
python escanear.py --dias 90     # los últimos 90 días
python escanear.py --proyecto .  # solo lo que pediste en esta carpeta
python escanear.py --top 30      # cuántos temas mostrar
```

Lee `~/.claude/history.jsonl`, que es donde Claude Code deja lo que le escribiste. Si recién
empezás y todavía no hay casi nada, te lo dice y seguimos por las preguntas.

## Las dos ideas que la sostienen

**Primero hacés el proceso, después lo convertís en skill.** Nunca al revés. Si nunca lo hiciste
completo, no tenés un proceso: tenés una idea, y una idea escrita en un SKILL.md sigue siendo
una idea.

**Si corre solo, sin vos, y siempre hace lo mismo, no es una skill.** Eso es una automatización
y se resuelve mejor en otro lado. Esta skill te lo va a decir aunque no sea lo que viniste
a buscar.

---

Hecha por Facundo Corengia — [facundocorengia.com](https://facundocorengia.com)
