import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
