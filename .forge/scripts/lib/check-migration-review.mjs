#!/usr/bin/env node
// forge check migration-review (REQ-05, rule data/migration-review.md): detecta migration
// tocada sem evidência de parecer de revisão especializada (data-engineer/data-relational).
// Zero-dependência: só node:fs/node:path/node:child_process.
//
// Modos:
//   check-migration-review.mjs range <rev-range> [--evidence <path>]
//   check-migration-review.mjs --path <dir> [--evidence <path>]
//
// `range` é o modo de push/CI: resolve os arquivos tocados via `git diff --name-only
// base..head` (forma base..head) ou `git diff-tree --root -r --name-only <sha>` (forma de
// sha/ref único — nunca `git diff --name-only <sha>`, que compara contra a árvore de trabalho).
// A evidência vem dos COMMITS do range, nunca do disco: só conta a linha de evidência que foi
// ADICIONADA ou ALTERADA no próprio range (diff de `migration-review.md` entre as pontas). Uma
// linha antiga, de um PR anterior, não cobre uma edição nova da mesma migration — migration
// alterada exige parecer novo (rule §"Exceção"/§"Evidência"). Um `migration-review.md` editado e
// não commitado, ou de outra branch checked-out, também não faz o gate passar.
//
// Listagem de paths sempre com `-c core.quotePath=false -z`: com o default do git, path com byte
// não-ASCII sai entre aspas e escapado em octal ("db/migrate/001_situa\303\247\303\243o.sql"), não
// casa nenhum padrão e a migration escapava do gate. E sempre `--no-renames`: com detecção de
// rename (default de `git diff`), mover uma migration para fora do diretório listava só o destino
// e passava sem evidência, enquanto a deleção pura era cobrada.
//
// `--path <dir>` é o modo ad-hoc/manual (revisão de um diretório específico materializado,
// ex.: o clone que o especialista está revisando): caminhamento recursivo próprio (não o
// collect() de source-scan.mjs, que filtra só por extname, não por glob de path) e evidência
// lida do disco (`<dir>/migration-review.md`) — aqui não há "commit sendo enviado", é
// inspeção direta.
//
// O script não analisa o SQL em si — só a forma/presença da linha de evidência. A qualidade
// do parecer é responsabilidade humana/agente (rule §"Quem revisa").
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

// Padrões de path de migration (default, fixos; sem leitura de config externa nesta
// entrega — extensão é editar esta constante). dbmate/Rails/node-pg-migrate, EF Core,
// Flyway, Alembic.
const MIGRATION_PATTERNS = [
  /(^|\/)db\/migrate\//,
  /(^|\/)db\/migrations\//,
  /(^|\/)migrations\//,
  /(^|\/)Migrations\/[^/]+\.cs$/,
  /(^|\/)src\/main\/resources\/db\/migration\//,
  /(^|\/)alembic\/versions\//,
];

// Mesmos diretórios ignorados por valor que source-scan.mjs usa (DEFAULT_SKIP) — não
// importado dele, para não acoplar à API de extensão do coletor genérico.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'bin', 'obj', '.forge', 'coverage',
  '.next', 'vendor', 'storybook-static', 'wwwroot', '_archive', 'TestResults',
  '.vs', '.idea', '.venv', '__pycache__', '.turbo', '.cache',
]);

function isMigrationPath(p) {
  const norm = p.split(sep).join('/');
  return MIGRATION_PATTERNS.some((re) => re.test(norm));
}

function run(cmd, args, opts = {}) {
  // maxBuffer explícito: o default de 1 MiB estoura (ENOBUFS) num push com muitos arquivos.
  return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
}

function gitFailReason(res) {
  if (res.error) return res.error.code || res.error.message;
  return (res.stderr || '').trim().split('\n')[0] || `exit ${res.status}`;
}

function parseArgs(argv) {
  const out = { mode: null, arg: null, evidence: null };
  let i = 0;
  if (argv[i] === 'range') { out.mode = 'range'; out.arg = argv[i + 1]; i += 2; }
  else if (argv[i] === '--path') { out.mode = 'path'; out.arg = argv[i + 1]; i += 2; }
  else { out.mode = null; }
  while (i < argv.length) {
    if (argv[i] === '--evidence') { out.evidence = argv[i + 1]; i += 2; }
    else { i += 1; }
  }
  return out;
}

// Casa cada linha de evidência: "- [x] <path>" (revisada) ou
// "- [exception] <path> item=<N> backlog=<ref> [adr=<ref>]" (exceção). item= é restrito a
// 1-13 (os itens do checklist da rule). Ordem exigida na linha é item= antes de backlog= antes
// de adr=, documentada na rule (seção "Exceção") — uma ordem diferente não casa e é tratada como
// evidência ausente. Texto livre depois do path de uma linha "[x]" é permitido (ex.: o sha
// revisado) — é o jeito de ATUALIZAR a linha quando a migration muda e recebe parecer novo.
const LINE_REVIEWED_RE = /^\s*-\s*\[x\]\s+(\S+)/;
const LINE_EXCEPTION_RE = /^\s*-\s*\[exception\]\s+(\S+)\s+item=(1[0-3]|[1-9])\s+backlog=(\S+)(?:\s+adr=(\S+))?/;

function parseEvidence(text) {
  // path -> lista de entradas { kind: 'reviewed' } | { kind: 'exception', item, backlog, adr }.
  // Lista, não valor único: com Map.set simples a última linha sobrescrevia as anteriores, e uma
  // exceção inválida (item=2 sem adr=) ficava mascarada por qualquer outra linha do mesmo path.
  const map = new Map();
  const add = (p, e) => { if (!map.has(p)) map.set(p, []); map.get(p).push(e); };
  for (const line of text.split('\n')) {
    let m = line.match(LINE_REVIEWED_RE);
    if (m) { add(m[1], { kind: 'reviewed' }); continue; }
    m = line.match(LINE_EXCEPTION_RE);
    if (m) add(m[1], { kind: 'exception', item: m[2], backlog: m[3], adr: m[4] || null });
  }
  return map;
}

function evaluate(path, evidenceMap, staleMap) {
  const entries = evidenceMap.get(path);
  if (!entries || !entries.length) {
    if (staleMap && staleMap.has(path)) {
      return { ok: false, reason: 'evidência existe mas não foi adicionada nem atualizada neste range — migration alterada exige parecer novo' };
    }
    return { ok: false, reason: 'sem evidência (nem revisada nem exceção)' };
  }
  // Qualquer exceção inválida do path reprova, mesmo que outra linha do mesmo path seja válida.
  const badItem2 = entries.find((e) => e.kind === 'exception' && e.item === '2' && !e.adr);
  if (badItem2) return { ok: false, reason: 'exceção do item 2 sem adr= (evidência inválida)' };
  if (entries.some((e) => e.kind === 'reviewed')) return { ok: true, msg: null };
  const exc = entries.filter((e) => e.kind === 'exception');
  return { ok: true, msg: exc.map((e) => `exceção item ${e.item}, backlog ${e.backlog}`).join('; ') };
}

function walkDir(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walkDir(join(dir, e.name), acc);
    } else {
      acc.push(join(dir, e.name));
    }
  }
  return acc;
}

const GIT = ['-c', 'core.quotePath=false'];

// Decompõe o rev-range: { twoPoint: true, base, head } para base..head / base...head (ponta
// vazia = HEAD, como o próprio git interpreta), ou { twoPoint: false, head } para sha/ref único.
function splitRange(rangeArg) {
  const m = rangeArg.match(/^(.*?)(\.{2,3})(.*)$/);
  if (!m) return { twoPoint: false, head: rangeArg };
  return { twoPoint: true, base: m[1] || 'HEAD', dots: m[2], head: m[3] || 'HEAD' };
}

function resolveRangeFiles(r, rangeArg) {
  const res = r.twoPoint
    ? run('git', [...GIT, 'diff', '--name-only', '-z', '--no-renames', rangeArg])
    : run('git', [...GIT, 'diff-tree', '--root', '-r', '--name-only', '-z', '--no-renames', '--no-commit-id', rangeArg]);
  if (res.error || res.status !== 0) return { error: true, reason: gitFailReason(res) };
  return { error: false, files: res.stdout.split('\0').filter(Boolean) };
}

// Linhas do arquivo de evidência ADICIONADAS (ou alteradas) no range — o texto que vale como
// evidência no modo range. Arquivo ausente no range ⇒ string vazia. `git diff` é porcelain e
// obedece à config do usuário: sem --no-color/--no-ext-diff/--no-textconv, color.ui=always punha
// escape ANSI antes do '+' (evidência lida como vazia ⇒ bloqueio de push válido) e diff.external
// trocava a saída inteira.
function readEvidenceAdded(r, rangeArg, evidencePath) {
  const res = r.twoPoint
    ? run('git', [...GIT, 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '-U0', rangeArg, '--', evidencePath])
    : run('git', [...GIT, 'diff-tree', '-p', '-U0', '--root', '--no-renames', '--no-commit-id', rangeArg, '--', evidencePath]);
  if (res.error || res.status !== 0) return '';
  return res.stdout.split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1))
    .join('\n');
}

function readEvidenceFromBlob(head, evidencePath) {
  const res = run('git', ['show', `${head}:${evidencePath}`]);
  if (res.error || res.status !== 0) return null; // blob ausente ⇒ tratado como ausente
  return res.stdout;
}

function readEvidenceFromDisk(path) {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

function formatResult(migrations, evidenceText, staleText) {
  const evidenceMap = parseEvidence(evidenceText || '');
  const staleMap = staleText == null ? null : parseEvidence(staleText);
  const fails = [];
  const passMsgs = [];
  for (const m of migrations) {
    const r = evaluate(m, evidenceMap, staleMap);
    if (!r.ok) fails.push(`${m}: ${r.reason}`);
    else if (r.msg) passMsgs.push(r.msg);
  }
  if (fails.length) {
    return { ok: false, text: `FAIL (${fails.join('; ')})` };
  }
  if (passMsgs.length) {
    // Texto exato do critério de aceite para o caso comum (uma exceção): "PASS (exceção item
    // N, backlog X)", sem prefixo de path. Qual migration está em exceção fica registrado no
    // próprio migration-review.md para quem precisar auditar.
    return { ok: true, text: `PASS (${passMsgs.join('; ')})` };
  }
  return { ok: true, text: 'PASS' };
}

function main() {
  const argv = process.argv.slice(2);
  const { mode, arg, evidence } = parseArgs(argv);

  if (mode === 'range') {
    if (!arg) {
      console.log('FAIL (usage: check-migration-review.mjs range <rev-range> [--evidence <path>])');
      process.exit(1);
    }
    // Um range começando com '-' viraria opção do git (ex.: --stdin, --output=...) e o gate
    // responderia PASS sem ter olhado commit nenhum.
    if (arg.startsWith('-')) {
      console.log(`FAIL (range inválido: ${arg} — não pode começar com '-')`);
      process.exit(1);
    }
    const r = splitRange(arg);
    const resolved = resolveRangeFiles(r, arg);
    if (resolved.error) {
      console.log(`FAIL (range inválido: ${arg} — ${resolved.reason})`);
      process.exit(1);
    }
    const migrations = resolved.files.filter(isMigrationPath);
    if (!migrations.length) {
      console.log('PASS (sem migration)');
      process.exit(0);
    }
    const evidencePath = evidence || 'migration-review.md';
    const added = readEvidenceAdded(r, arg, evidencePath);
    // O blob inteiro só serve ao diagnóstico ("existe, mas não foi atualizada neste range").
    const blob = readEvidenceFromBlob(r.head, evidencePath);
    const result = formatResult(migrations, added, blob || '');
    console.log(result.text);
    process.exit(result.ok ? 0 : 1);
  }

  if (mode === 'path') {
    if (!arg) {
      console.log('FAIL (usage: check-migration-review.mjs --path <dir> [--evidence <path>])');
      process.exit(1);
    }
    if (!existsSync(arg) || !statSync(arg).isDirectory()) {
      console.log(`FAIL (diretório não encontrado: ${arg})`);
      process.exit(1);
    }
    const allFiles = walkDir(arg);
    const migrations = allFiles
      .map((f) => relative(arg, f).split(sep).join('/'))
      .filter(isMigrationPath);
    if (!migrations.length) {
      console.log('PASS (sem migration)');
      process.exit(0);
    }
    const evidencePath = evidence ? evidence : join(arg, 'migration-review.md');
    const evidenceText = readEvidenceFromDisk(evidencePath);
    const result = formatResult(migrations, evidenceText, null);
    console.log(result.text);
    process.exit(result.ok ? 0 : 1);
  }

  console.log('FAIL (usage: check-migration-review.mjs range <rev-range> | --path <dir>)');
  process.exit(1);
}

main();
