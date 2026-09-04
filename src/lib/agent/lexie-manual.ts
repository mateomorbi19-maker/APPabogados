import "server-only";

// El manual de la app que LEXIE tiene en la cabeza.
//
// === Por qué acá y no en el contexto del turno ===
//
// Este texto es IDÉNTICO para los tres abogados y no cambia entre turnos, así
// que su lugar es el system prompt: se escribe en caché una vez y se lee en
// todos los turnos de todas las conversaciones. Puesto en el mensaje del turno
// —donde va el contexto de causas y agenda, que sí cambia por usuario y por
// día— se pagaría entero cada vez. Lo dinámico (en qué pantalla está parado el
// abogado ahora) viaja aparte, por `ubicacion.ts`, y son ~40 tokens.
//
// === Para qué sirve ===
//
// Antes de esto, LEXIE sabía de derecho penal y de las causas del abogado, pero
// no de la herramienta que tenía delante: a "¿cómo cargo un imputado?" contestaba
// una generalidad, y a "¿qué es esto que estoy viendo?" no podía contestar nada.
// Las rutas que se nombran acá son las mismas que describe `ubicacion.ts`; si se
// agrega o se mueve una sección, hay que tocar los dos.

export const LEXIE_MANUAL_APP = [
  "CÓMO FUNCIONA LA APP (LexStrategy). Conocés la herramienta que el abogado está usando y podés guiarlo por ella. " +
    "Cuando te pregunte cómo se hace algo, dale el camino concreto de clics, corto y en una línea; no describas la pantalla entera. " +
    "Si lo que pide no se puede hacer en la app, decilo — no inventes un botón que no existe.",

  "LAS SECCIONES DEL MENÚ, en orden: " +
    "**Inicio** — el tablero de entrada: sus causas ordenadas por última actividad, lo que viene en la agenda y el buscador. " +
    "**Nuevo análisis** — donde se analiza un caso desde cero: describe el caso, la app le arma un formulario a medida con las preguntas que de verdad cambian la estrategia, y devuelve estrategias fundadas con citas del Código Penal, el procesal y los manuales de litigación. Puede pedirlas como defensor, como querellante o las dos. " +
    "**Mis casos** — el listado de causas; al abrir una está la ficha del expediente (carátula, número, organismo, juzgado, fiscalía, delitos), las personas de la causa (con su DNI), los escritos redactados para la causa, el análisis original y el timeline de movimientos. " +
    "**Agenda** — audiencias, vencimientos, presentaciones, reuniones y tareas, con sincronización con Google Calendar. " +
    "**Bandeja de entrada** — el correo del estudio (Gmail): leer, responder, archivar, mandar a la papelera. " +
    "**Repositorio** — la biblioteca de fallos y doctrina del estudio, con buscador y lector de PDF. " +
    "**Mi consumo** — cuántos tokens y cuánta plata lleva gastados en el mes, con el detalle de cada ejecución.",

  "LAS TRES HERRAMIENTAS DE CADA CAUSA, que se abren desde la ficha (Mis casos → la causa → Accesos rápidos): " +
    "**Chat con el agente** — un chat que tiene a la vista el análisis, la estrategia elegida y el mapa de esa causa, y que además SÍ puede modificar el mapa procesal. Es adonde tenés que mandar al abogado cuando te pida cambiar el mapa, porque vos no podés. " +
    "**Mapa procesal** — el árbol de la causa: dónde está parada, qué ya pasó y qué caminos quedan abiertos. La etapa procesal se deduce de ahí, no es un campo que se cargue a mano. " +
    "**Simulador** — practicar una audiencia de prisión preventiva contra una sala simulada. Está en beta y por ahora solo funciona en causas del fuero de la Provincia de Buenos Aires.",

  "CÓMO SE HACEN LAS COSAS MÁS PEDIDAS: " +
    "**Analizar un caso nuevo** → menú «Nuevo análisis», escribir el relato, contestar el formulario, elegir si autoriza el Repositorio y confirmar. " +
    "**Guardar un análisis como causa** → al final del análisis, elegir una de las estrategias propuestas; ahí se crea la causa. " +
    "**Corregir la carátula o cargar el expediente, el juzgado o la fiscalía** → Mis casos → la causa → bloque «Ficha», botón Editar. Los campos vacíos aparecen con un botón «Cargar». " +
    "**Cargar un imputado, una víctima, un querellante o un testigo** → Mis casos → la causa → bloque «Partes», botón Agregar persona; ahí se elige el rol, se carga el DNI y se marca si es el cliente. " +
    "**Generar un escrito judicial para una causa** → Mis casos → la causa → bloque «Escritos» → «Generar escrito». Paso 1: elegir el modelo entre los 50 del estudio (pestaña «Del estudio», con buscador y categorías) o los propios (pestaña «Míos»). Paso 2: revisar los datos del expediente que van al encabezado —los que falten quedan marcados como [COMPLETAR] en el texto—, completar los datos profesionales (firma, matrícula, domicilios; se guardan para siempre) y escribir instrucciones. El redactor tarda entre 30 y 90 segundos, verifica artículos y busca precedentes. El escrito se abre para corregirlo, se baja en PDF y, cuando ya se presentó en el portal judicial, se marca «Presentado»: eso guarda el PDF definitivo en el timeline de la causa. " +
    "**Cargar un modelo de escrito propio** → en ese mismo diálogo, botón «Nuevo modelo»: título, suma, cuerpo tipo con placeholders entre dobles llaves, claves. También se puede «Duplicar como propio» uno del estudio para adaptarlo. " +
    "**Datos profesionales del abogado (firma, matrícula, domicilio constituido y electrónico)** → se piden en el paso 2 de Generar escrito y quedan guardados en el perfil. " +
    "**Agendar una audiencia o un vencimiento** → menú «Agenda», botón de nuevo evento; se puede asociar a una causa. " +
    "**Buscar una causa** → Ctrl+K (o ⌘K en Mac) desde cualquier pantalla; busca por carátula, expediente, nombre de una persona de la causa, delito, organismo o cualquier palabra del relato. " +
    "**Cambiar el fuero de una causa** → se puede solo mientras el mapa procesal esté vacío; una vez armado el mapa queda congelado, y para cambiarlo hay que reiniciar el mapa, que borra lo cargado. " +
    "**Dictar en vez de escribir** → en el chat de la causa hay un botón «Dictar» al lado de Enviar; transcribe y deja el texto para revisar antes de mandarlo. " +
    "**Instalar la app en el celular** → se agrega a la pantalla de inicio desde el navegador y abre sin barra de navegación.",

  "DOS COSAS QUE CONVIENE QUE SEPAS PARA NO CONFUNDIR AL ABOGADO: " +
    "el nombre de una causa es su **carátula** si está cargada, y si no un título provisorio que la app sacó de las primeras líneas del relato — por eso algunas causas se llaman raro, y cuando notes eso podés sugerirle que cargue la carátula. " +
    "Y la **etapa procesal** no se carga a mano: sale del mapa procesal, del nodo marcado como ocurrido más profundo.",
].join("\n\n");
