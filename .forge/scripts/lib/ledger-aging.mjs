// ledger-aging — idade determinística das entradas ativas do ledger durável (change
// add-ledger-evidence-aging, REQ-05/REQ-06). Uma fonte só para o cálculo: `ledger-ops.sh stale`,
// o sufixo do `status`, a marca do `list` e, por delegação ao `stale`, a linha do `/forge:doctor`.
//
// Por que existe. Um item do ledger é uma afirmação sobre o código feita numa data; o código muda
// depois e ninguém reconfere. Medido no ledger do próprio harness em 2026-10-30: 38 itens ativos,
// todos com mais de 30 dias desde o registro, 23 nunca tocados depois de criados. Envelhecer em
// silêncio era o estado padrão.
//
// Regras (todas determinísticas — nenhuma leitura de relógio de parede):
//   - universo = entradas fora do conjunto encerrado (para um ledger conforme ao enum: open,
//     planned, in-progress); encerradas nunca envelhecem;
//   - referência = last_verified, se presente; senão created_at;
//   - idade = floor((asOf - referência) / 1 dia), com asOf vindo de quem chama (commit HEAD ou
//     --as-of), nunca do relógio de parede;
//   - envelhecida = idade estritamente maior que o limiar;
//   - inconsistência sai do cálculo e é listada, nunca tratada como item recente: referência não
//     interpretável, referência posterior ao asOf, last_verified sem evidence, last_verified
//     diferente do maior evidence[].at (last_verified é carimbado só por `verify`, sempre junto do
//     registro que o justifica — divergência entre os dois é edição à mão ou porta quebrada).
//
// CLI (chamado por ledger-ops.sh):
//   node ledger-aging.mjs report  <ledger.json> <asOf> <dias> <origem-do-limiar>
//   node ledger-aging.mjs summary <ledger.json> <asOf> <dias>        -> "K A J" (J = inconsistentes)
//   node ledger-aging.mjs ages    <ledger.json> <asOf> <dias>        -> "id idade" por envelhecida e
//                                                                        "id !" por inconsistente
// Inconsistência nunca some na fiação: um last_verified editado à mão sem evidência apareceria como
// "reverificado" no list e contaria como em dia no status/doctor se só o `stale` o listasse.
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Encerrado = mesmo conjunto que status/render usam. Ativo é o complemento (para um ledger conforme
// ao enum: open, planned, in-progress), de modo que um consumidor com enum estendido não vê o
// cabeçalho do stale divergir da contagem do status.
export const CLOSED = new Set(['resolved', 'wont-fix', 'promoted', 'superseded']);
const DAY_MS = 86400000;

export function ageReport(entries, { asOf, days }) {
  const asOfMs = Date.parse(asOf);
  const universe = [];
  const stale = [];
  const inconsistent = [];
  for (const e of entries || []) {
    if (!e || CLOSED.has(e.status)) continue;
    universe.push(e.id);
    const ev = Array.isArray(e.evidence) ? e.evidence : [];
    const hasLV = e.last_verified != null && e.last_verified !== '';
    if (hasLV && ev.length === 0) { inconsistent.push({ id: e.id, reason: 'last_verified sem evidence (nenhum registro de reverificação o justifica)' }); continue; }
    if (hasLV) {
      // Comparação CRONOLÓGICA (Date.parse), nunca lexical: commits com offsets diferentes não
      // podem gerar falso positivo.
      const ats = ev.map((x) => Date.parse(x && x.at)).filter((n) => !Number.isNaN(n));
      const maxAt = ats.length ? Math.max(...ats) : NaN;
      if (Number.isNaN(maxAt) || Date.parse(e.last_verified) !== maxAt) { inconsistent.push({ id: e.id, reason: `last_verified (${e.last_verified}) diferente do maior evidence.at` }); continue; }
    }
    const ref = hasLV ? e.last_verified : e.created_at;
    const refMs = Date.parse(ref);
    if (Number.isNaN(refMs)) { inconsistent.push({ id: e.id, reason: `data de referência não interpretável (${JSON.stringify(ref ?? null)})` }); continue; }
    const age = Math.floor((asOfMs - refMs) / DAY_MS);
    if (age < 0) { inconsistent.push({ id: e.id, reason: `data de referência posterior ao as_of (${ref})` }); continue; }
    if (age > days) stale.push({ id: e.id, age, verified: hasLV, refDay: String(ref).slice(0, 10), title: e.title || '' });
  }
  stale.sort((a, b) => (b.age - a.age) || a.id.localeCompare(b.id));
  inconsistent.sort((a, b) => a.id.localeCompare(b.id));
  return { universe, stale, inconsistent };
}

export function formatReport(r, { asOf, days, origin }) {
  const lines = [];
  lines.push(`LEDGER stale: ${r.stale.length} de ${r.universe.length} ativo(s) sem reverificação há mais de ${days} dia(s) (referência ${String(asOf).slice(0, 10)}, limiar ${days} de ${origin})`);
  for (const s of r.stale) {
    const how = s.verified ? `reverificado em ${s.refDay}` : `nunca reverificado (registrado em ${s.refDay})`;
    lines.push(`${s.id} — ${s.age}d — ${how} — ${s.title}`);
  }
  if (r.inconsistent.length) {
    lines.push(`inconsistente(s): ${r.inconsistent.length}`);
    for (const i of r.inconsistent) lines.push(`  ${i.id} — ${i.reason}`);
  }
  return lines.join('\n');
}

function main(argv) {
  const [mode, file, asOf, daysRaw, origin] = argv;
  const days = parseInt(daysRaw, 10);
  let data;
  try { data = JSON.parse(readFileSync(file, 'utf8')); } catch (err) {
    process.stderr.write(`FAIL: ledger-aging: ledger ilegível (${file}): ${err.message}\n`);
    process.exit(2);
  }
  const r = ageReport(Array.isArray(data.entries) ? data.entries : [], { asOf, days });
  if (mode === 'summary') { process.stdout.write(`${r.stale.length} ${r.universe.length} ${r.inconsistent.length}\n`); return 0; }
  if (mode === 'ages') {
    for (const s of r.stale) process.stdout.write(`${s.id} ${s.age}\n`);
    for (const i of r.inconsistent) process.stdout.write(`${i.id} !\n`);
    return 0;
  }
  process.stdout.write(formatReport(r, { asOf, days, origin }) + '\n');
  return r.stale.length + r.inconsistent.length > 0 ? 10 : 0;
}

let isMain = false;
try { isMain = realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); } catch { isMain = false; }
if (isMain) {
  process.exit(main(process.argv.slice(2)));
}
