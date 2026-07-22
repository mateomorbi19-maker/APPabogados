import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // El guion del Simulador de Audiencias se lee con fs.readFileSync en runtime
  // (src/lib/simulador/contexto.ts). Next no puede trazar una lectura dinámica,
  // así que en `output: 'standalone'` el .md no se copiaría y el endpoint
  // tiraría ENOENT en el deploy. Con esto se incluye en el bundle.
  //
  // La clave es un GLOB, no una ruta literal: usar "/api/casos/[id]/..." NO
  // funcionaría porque `[id]` se interpreta como clase de caracteres. Por eso
  // se cubre todo /api — el archivo pesa ~7 KB, el costo es despreciable.
  outputFileTracingIncludes: {
    "/api/**": ["./src/lib/simulador/guion-pp.md"],
  },
  turbopack: {
    // process.cwd() en vez de __dirname: en el build de Docker el config se
    // compila a ESM (fallback a SWC WASM, sin binario nativo de Linux) y
    // __dirname no existe en scope ESM → el build moría al cargar el config.
    // cwd = raíz del proyecto (donde corre `next build`); equivale a __dirname
    // acá y es válido tanto en CJS como en ESM. En Windows el SWC nativo compila
    // el config a CJS, por eso el bug solo se disparaba fuera de Windows.
    root: process.cwd(),
  },
};

export default nextConfig;
