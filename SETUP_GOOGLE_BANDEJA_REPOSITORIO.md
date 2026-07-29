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
- **El agente de IA no manda correos.** La Bandeja es 100% manual: la IA no tiene
  ninguna tool de email. Enviar siempre es un click tuyo.
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
