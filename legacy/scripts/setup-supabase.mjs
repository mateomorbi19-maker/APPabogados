// Verifica que las tablas y los 3 usuarios existan en Supabase.
// El schema (DDL) se aplica una vez con `supabase-schema-original.sql` en el SQL Editor.
//
// Uso:
//   npm install @supabase/supabase-js dotenv
//   node legacy/scripts/setup-supabase.mjs

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en .env');
  process.exit(1);
}

const supabase = createClient(url, key);

const { data: usuarios, error: errU } = await supabase.from('usuarios').select('nombre, limite_tokens_mensual');
if (errU) {
  console.error('Error consultando usuarios:', errU.message);
  console.error('¿Ya corriste legacy/supabase-schema-original.sql en el SQL Editor de Supabase?');
  process.exit(1);
}

const esperados = ['Lautaro', 'Gonzalo', 'Mateo'];
const presentes = usuarios.map(u => u.nombre).sort();
const faltantes = esperados.filter(n => !presentes.includes(n));

console.log('Usuarios en Supabase:', presentes);
if (faltantes.length) {
  console.error('FALTAN usuarios:', faltantes, '→ corré legacy/supabase-schema-original.sql en el SQL Editor.');
  process.exit(1);
}

const { error: errV } = await supabase.from('v_consumo_mensual').select('nombre').limit(1);
if (errV) {
  console.error('La vista v_consumo_mensual no existe:', errV.message);
  process.exit(1);
}

console.log('Schema OK: usuarios cargados, vista v_consumo_mensual disponible.');
