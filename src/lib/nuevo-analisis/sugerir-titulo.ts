// Sugerencia automática del título de un caso a partir del texto del caso
// original. Reglas:
//   - Si el caso ≤ 60 chars → tal cual.
//   - Si > 60: tomar los primeros 60 chars y cortar en el ÚLTIMO punto,
//     coma o salto de línea encontrado, para no cortar a mitad de palabra
//     y mantener una frase legible.
//   - Si en esos 60 chars no hay ningún separador, cortar en char 60 y
//     agregar "..." (caso raro: caso sin puntuación).
//
// Esta interpretación matchea el ejemplo dado: "Sebastián, ciudadano
// paraguayo de 34 años, llegó a Ezeiza..." (>60 chars) →
// "Sebastián, ciudadano paraguayo de 34 años" (corta en la última coma
// antes del char 60). Una interpretación literal "primer separador" daría
// solo "Sebastián", que no es lo que se pide.

export function sugerirTitulo(caso: string): string {
  const t = caso.trim();
  if (t.length <= 60) return t;
  const inicio = t.slice(0, 60);
  const seps = [".", ",", "\n"];
  for (let i = inicio.length - 1; i >= 0; i--) {
    if (seps.includes(inicio[i])) {
      return inicio.slice(0, i).trim();
    }
  }
  return inicio.trim() + "...";
}
