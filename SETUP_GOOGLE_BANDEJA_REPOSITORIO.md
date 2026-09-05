# Activar Bandeja de entrada (Gmail) y Repositorio (Drive)

> Checklist para Mateo. El código ya está: falta **configuración**, no desarrollo.
> Mientras esto no esté hecho, las dos secciones se ven y se navegan igual — la
> Bandeja con datos de ejemplo claramente marcados, y el Repositorio con el
> catálogo real pero abriendo los PDF en Drive en vez de dentro de la app.

---

## Por qué no hace falta ninguna credencial nueva en `.env`

Las integraciones con Google de esta app **no tienen OAuth propio**. El token lo
administra Clerk: `clerkClient().users.getUserOauthAccessToken(userId, "google")`.
Es exactamente el mismo mecanismo que ya usa la Agenda con Google Calendar. Por
eso habilitar Gmail y Drive es trabajo en dos consolas, y cero secretos nuevos.

Helper compartido: [src/lib/google/token.ts](src/lib/google/token.ts).

---

## Paso 1 — Google Cloud Console

En el **mismo proyecto** que ya tiene las credenciales OAuth que usa Clerk
(el que habilitaste para Calendar):

1. *APIs y servicios → Biblioteca* → habilitar **Gmail API**.
2. Misma pantalla → habilitar **Google Drive API**.

## Paso 2 — Pantalla de consentimiento OAuth

Los scopes de Gmail son **restricted** para Google. Si la app estuviera en
*Production* haría falta un proceso de verificación (video, política de
privacidad, semanas de espera). **No lo necesitamos**: con la pantalla en
**Testing** y los 3 mails cargados como *test users*, los scopes restricted
funcionan sin verificación. El límite de Testing es 100 usuarios; nosotros somos 3.

En *APIs y servicios → Pantalla de consentimiento de OAuth*:

1. Verificar que **Publishing status = Testing**.
2. En *Test users*, que estén los tres:
   - `mateomorbi19@gmail.com`
   - `gonzalo.ezequiel.brandoni@gmail.com`
   - `lautiicardoso@gmail.com`
3. Agregar los scopes (si la consola te pide declararlos ahí):
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/drive.readonly`

> **Ojo con Testing:** el refresh token de Google caduca a los 7 días en modo
> Testing. En la práctica eso significa que cada tanto hay que volver a entrar
> con Google. Es el costo de no pasar por la verificación de Google. Si molesta,
> la alternativa es publicar la app y pasar la verificación.

## Paso 3 — Clerk Dashboard

*SSO Connections → Google → Scopes*. Agregar a los que ya están:

```
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/drive.readonly
```

Tiene que ser la conexión con **credenciales custom** (las shared de desarrollo
de Clerk no permiten scopes adicionales). Ya la tenés así por Calendar.

## Paso 4 — Re-login de los tres usuarios

Clerk **no hace consentimiento incremental**: un scope agregado no se pide solo.
Cada uno tiene que **salir de la app y volver a entrar con Google**, y aceptar la
pantalla de permisos nueva. En la app, el botón de "Salir" del menú lateral
alcanza; los banners de las dos secciones nuevas ya ofrecen ese botón.

## Paso 5 — Carpeta de Drive

La carpeta del repositorio
(`1Co0Bhm8CGMStz7Hyo5cVwnaA-J3Zrbkv`) es de Gonzalo. Para que los tres puedan
**leer los PDF dentro de la app**, la carpeta tiene que estar compartida con los
tres mails, aunque sea como *Lector*. Si alguien no tiene acceso, la app se lo
dice y le ofrece abrir el archivo en Drive.

---

## Cómo verificar que quedó bien

| Qué | Dónde | Resultado esperado |
|---|---|---|
| Gmail conectado | `GET /api/bandeja/estado` | `{"conectado":true,"vinculado":true,"email":"..."}` |
| Drive conectado | `GET /api/repositorio/estado` | `{"conectado":true,"total_documentos":345}` |
| Bandeja real | `/dashboard/bandeja` | Desaparece el banner ámbar y los badges "Ejemplo"; aparecen tus mails |
| Lector de PDF | `/dashboard/repositorio` → abrir cualquier fallo | El PDF se ve embebido, no el aviso de "Abrir en Drive" |

Si `conectado` sigue en `false` después del re-login, casi siempre es que el
scope no quedó guardado en Clerk o que el usuario no aceptó la pantalla nueva de
Google (se saltea rápido si ya había consentido antes).

---

## Lo que queda fuera de alcance a propósito

- **La app nunca borra un correo de forma permanente.** "Borrar" mueve a la
  papelera de Gmail (`threads.trash`), que es reversible desde la propia app y
  desde Gmail. Por eso alcanza con `gmail.modify` y no hace falta el scope total
  `https://mail.google.com/`.
- **LEXIE puede buscar, leer, organizar, responder y enviar correo (Fase 11),
  pero nunca sin tu confirmación.** Un envío o una respuesta queda como acción
  pendiente con Para/CC/asunto/cuerpo completos, y sale sólo cuando tocás
  Confirmar en la tarjeta (o se lo decís con un sí inequívoco en el mensaje
  siguiente). Un correo nuevo sólo puede ir a direcciones que escribiste vos en
  el chat o a las que ya les mandaste antes; lo que dice un correo recibido
  nunca es una instrucción para LEXIE. Sin el scope de Gmail concedido, LEXIE
  no tiene esas herramientas y te dice cómo reconectar.
- El **Repositorio es de sólo lectura**: no sube ni modifica archivos en Drive.

---

## Regenerar el catálogo del Repositorio

El catálogo vive versionado en el repo ([src/lib/repositorio/catalogo.ts](src/lib/repositorio/catalogo.ts),
345 documentos deduplicados a partir de 351 archivos). No está en Supabase a
propósito: así funciona sin migraciones y la búsqueda es instantánea.

Cuando Gonzalo agregue fallos nuevos a Drive, hay que volver a enumerar la
carpeta y regenerar:

```bash
npx tsx scripts/construir-catalogo-repositorio.ts
```

El script lee `scripts/data/drive-catalogo.json`. Ese JSON hoy se generó
enumerando Drive desde afuera de la app; falta automatizar ese paso (queda como
pendiente).

---

## Que la IA pueda CITAR el repositorio (dos pasos, una sola vez)

Navegar la biblioteca funciona con el catálogo. Para que el agente del chat y de
las estrategias pueda **citar** un fallo hace falta indexar el contenido de los
PDF. Son dos pasos y se corren una sola vez; después la ingesta es incremental.

### Paso A — aplicar la migración

En el **SQL Editor de Supabase**, pegar y ejecutar entero el archivo:

```
supabase/migrations/20260807120000_repositorio_rag.sql
```

Crea dos tablas (`repositorio_documentos`, `repositorio_chunks`) y dos funciones
de búsqueda. Es puramente aditiva: no toca `documentos` ni el RAG que ya existe.

### Paso B — correr la ingesta

```bash
npm run repo:ingesta
```

Baja los 345 PDF de Drive (con tu propio permiso de Google, sin credenciales
nuevas), extrae el texto, le pide al modelo una ficha por documento y guarda todo
con embeddings. Tarda ~20 minutos y cuesta **~USD 3,30 la primera vez** (las
fichas, medido sobre fallos reales). Las corridas siguientes saltean lo que no
cambió y salen centavos.

Si algún día querés re-generar el fichero con el modelo más caro (Sonnet, ~USD 13
la corrida completa), `--modelo preciso`. En la comparación sobre los mismos
fallos las fichas salieron equivalentes, así que no vale la pena de entrada.

Si el presupuesto es cero, `--sin-ficha` hace la corrida sólo con embeddings
(centavos). El agente igual puede citar pasajes textuales, pero elige peor qué
fallo traer, porque el ranking pasa a apoyarse en el título y la primera página
en vez de en un resumen de lo que el fallo resolvió.

Antes de gastar la corrida completa conviene mirar qué está extrayendo:

```bash
npm run repo:ingesta -- --dry-run --con-ficha --limite 3
```

**Ojo con el disco:** el corpus completo agrega ~240 MB a la base (vectores +
índice). Si el proyecto de Supabase está en el plan Free (500 MB), ingerí primero
sólo los fallos y medí antes de sumar la doctrina:

```bash
npm run repo:ingesta -- --coleccion jurisprudencia
```

### Cómo verificar

`GET /api/repositorio/estado` devuelve `documentos_indexados`:

| Valor | Significa |
|---|---|
| `null` | La migración del paso A no está aplicada. |
| `0` | Migración aplicada, ingesta sin correr. |
| ~300 | Listo: el agente puede citar. |

### Los 45 documentos que no van a entrar

45 de los 345 son **escaneos sin capa de texto** (varios leading cases de la CSJN:
Fiorentino, Rayford, Mattei...) más 3 archivos `.doc` viejos. Quedan registrados
con `estado = 'sin_texto'`: se siguen viendo y descargando en el Repositorio, pero
el agente no los puede citar porque no tiene su texto. Si alguno importa mucho,
pasarlo por OCR (Drive lo hace al abrirlo con Google Docs) y volver a subirlo:
la próxima corrida lo incorpora solo.
