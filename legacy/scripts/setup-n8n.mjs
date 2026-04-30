// Reaplica los cambios en n8n (workflow analizar-caso + workflow consultar-consumo).
// Idempotente: si los workflows ya existen, los actualiza. Si no, los crea.
//
// Uso:
//   node scripts/setup-n8n.js

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const N8N_API_URL = process.env.N8N_API_URL;
const N8N_API_KEY = process.env.N8N_API_KEY;
if (!N8N_API_URL || !N8N_API_KEY) {
  console.error('Faltan N8N_API_URL o N8N_API_KEY en .env');
  process.exit(1);
}

const headers = { 'X-N8N-API-KEY': N8N_API_KEY, 'Content-Type': 'application/json' };
const api = (p) => `${N8N_API_URL}/api/v1${p}`;

async function listWorkflows() {
  const r = await fetch(api('/workflows'), { headers });
  if (!r.ok) throw new Error('list workflows: ' + r.status);
  return (await r.json()).data;
}

async function getWorkflow(id) {
  const r = await fetch(api(`/workflows/${id}`), { headers });
  if (!r.ok) throw new Error('get workflow ' + id + ': ' + r.status);
  return r.json();
}

async function putWorkflow(id, body) {
  const clean = {
    name: body.name,
    nodes: body.nodes,
    connections: body.connections,
    settings: { executionOrder: 'v1' }
  };
  const r = await fetch(api(`/workflows/${id}`), { method: 'PUT', headers, body: JSON.stringify(clean) });
  if (!r.ok) throw new Error('put workflow ' + id + ': ' + r.status + ' ' + await r.text());
  return r.json();
}

async function postWorkflow(body) {
  const r = await fetch(api('/workflows'), { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('post workflow: ' + r.status + ' ' + await r.text());
  return r.json();
}

async function activate(id) {
  await fetch(api(`/workflows/${id}/deactivate`), { method: 'POST', headers });
  await new Promise(r => setTimeout(r, 800));
  const r = await fetch(api(`/workflows/${id}/activate`), { method: 'POST', headers });
  if (!r.ok) throw new Error('activate ' + id + ': ' + r.status + ' ' + await r.text());
}

const consultar = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'workflows-template', 'consultar-consumo.json'), 'utf-8'));

const all = await listWorkflows();
const consultarExisting = all.find(w => w.name === consultar.name);
let consultarId;
if (consultarExisting) {
  console.log('Actualizando consultar-consumo (id=' + consultarExisting.id + ')...');
  await putWorkflow(consultarExisting.id, consultar);
  consultarId = consultarExisting.id;
} else {
  console.log('Creando consultar-consumo...');
  const created = await postWorkflow(consultar);
  consultarId = created.id;
}
await activate(consultarId);
console.log('OK consultar-consumo activo:', consultarId);

const analizarExisting = all.find(w => w.name.includes('Analizar Caso'));
if (!analizarExisting) {
  console.log('No encontré el workflow analizar-caso (nada que actualizar).');
} else {
  console.log('analizar-caso ya existe (id=' + analizarExisting.id + '). No lo modifico desde acá; usá los scripts de patch específicos en /tmp si necesitás reaplicar tracking.');
}

console.log('Listo.');
