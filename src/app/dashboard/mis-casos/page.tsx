// Página default de /dashboard/mis-casos cuando no hay id en la URL.
// El shell (layout) ya renderizó la sidebar con la lista; acá solo va el
// mensaje neutro para la columna derecha. Si la sección está totalmente
// vacía, el shell muestra empty state full-width y este componente no se
// llega a ver porque queda dentro del slot que tampoco se renderiza.
//
// (Cuando exista al menos un caso pero el usuario no eligió ninguno,
// el shell muestra sidebar + esta página al lado derecho.)
export default function MisCasosIndex() {
  return (
    // Oculto abajo de 768px: ahí no hay dos columnas, así que la lista ES la
    // página y este cartel solo agregaba 60vh de vacío para scrollear al
    // final. dvh en vez de vh para que no lo desajusten las barras del
    // browser móvil.
    <div className="hidden md:flex items-center justify-center min-h-[60dvh] text-center">
      <p className="text-sm text-muted-foreground max-w-md">
        Seleccioná un caso de la lista para ver el detalle.
      </p>
    </div>
  );
}
