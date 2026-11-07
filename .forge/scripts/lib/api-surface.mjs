#!/usr/bin/env node
// forge shared engine — api-surface. Zero-dependency.
//
// Reúne o que os ARTEFATOS declaram como superfície HTTP, para cruzar contra o que o código de
// fato expõe (route-scan.mjs). Quatro fontes possíveis, e a regra de composição é o ponto
// central deste módulo:
//
// ── União, nunca precedência-com-fallback ──────────────────────────────────────────────────
// A tentação é ordenar as fontes e usar a primeira que responder: "se tem OpenAPI, usa OpenAPI;
// senão, cai na tabela; senão, no checklist". Isso reproduz exatamente a forma do defeito que
// este trabalho existe para eliminar — a fonte menos completa silencia a mais completa, e o
// endpoint que só a tabela conhece desaparece do cruzamento porque um OpenAPI incompleto
// respondeu primeiro. Aqui todas as fontes são lidas e o resultado é a UNIÃO dos endpoints,
// com `sources[]` registrando quem declarou cada um.
//
// Precedência existe, e só para METADADO DIVERGENTE do mesmo endpoint (qual policy, qual
// resumo): `authz-map > openapi > tabela > checklist`. Precedência de metadado não some com
// endpoint nenhum — é desempate, não filtro.
//
// ── Fonte que falha em silêncio é a mesma doença ───────────────────────────────────────────
// Um contrato ilegível, um YAML que o parser não aceita, um arquivo que não abre: tratar
// qualquer um deles como "nenhum endpoint declarado" deixa o SUR-01 verde por vacuidade, que é
// exatamente o pré-requisito-ausente-vira-verde que o harness proíbe. Toda fonte que o coletor
// tentou ler e não conseguiu vira `unresolved`, no mesmo contrato do route-scan.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import { collect, DEFAULT_SKIP } from './source-scan.mjs';
import { normalizePath, joinPath } from './route-scan.mjs';
import { parseYamlSubset } from './yaml-lite.mjs';

const HTTP_VERBS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

/** Ordem de desempate de metadado. Índice menor ganha. Não filtra endpoint. */
export const SOURCE_PRECEDENCE = ['authz-map', 'openapi', 'table', 'checklist'];

function key(method, path) {
  return `${method.toUpperCase()} ${normalizePath(path)}`;
}

function upsert(map, { method, path, source, file, line, policy, summary }) {
  const k = key(method, path);
  const existing = map.get(k);
  if (!existing) {
    map.set(k, {
      method: method.toUpperCase(),
      path: normalizePath(path),
      sources: [source],
      declarations: [{ source, file, line, policy, summary }],
      policy: policy || null,
      summary: summary || null,
    });
    return;
  }
  if (!existing.sources.includes(source)) existing.sources.push(source);
  existing.declarations.push({ source, file, line, policy, summary });

  // Desempate de metadado: só substitui quando a fonte nova tem precedência maior E traz valor.
  const rank = (s) => {
    const i = SOURCE_PRECEDENCE.indexOf(s);
    return i === -1 ? SOURCE_PRECEDENCE.length : i;
  };
  const currentRank = Math.min(...existing.declarations.filter((d) => d.policy).map((d) => rank(d.source)), SOURCE_PRECEDENCE.length);
  if (policy && rank(source) <= currentRank) existing.policy = policy;
  if (summary && !existing.summary) existing.summary = summary;
}

// ── Fonte 1: authz-map (endpoint → policy) ─────────────────────────────────────────────────
// Formato aceito: YAML com lista de entradas contendo `method`/`path` (ou `endpoint: "GET /x"`).
export function fromAuthzMap(text, file = 'authz-map', unresolved = []) {
  const out = [];
  let doc;
  try {
    doc = parseYamlSubset(text);
  } catch (err) {
    unresolved.push({
      kind: 'authz-map-unparsed',
      file,
      detail: `o parser YAML não aceitou o arquivo (${String(err && err.message).slice(0, 80)}); os endpoints que só ele declara não entram no cruzamento`,
    });
    return out;
  }
  const entries = [];
  const visit = (node) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    if (node.path || node.endpoint) entries.push(node);
    for (const v of Object.values(node)) visit(v);
  };
  visit(doc);
  if (entries.length === 0) {
    unresolved.push({
      kind: 'authz-map-without-entries',
      file,
      detail: 'nenhuma entrada com `path`/`endpoint` foi reconhecida — arquivo declarado como authz-map e sem superfície extraída',
    });
    return out;
  }

  for (const e of entries) {
    let method = e.method;
    let path = e.path;
    if (!path && typeof e.endpoint === 'string') {
      const m = e.endpoint.trim().match(/^([A-Za-z]+)\s+(\/\S*)$/);
      if (m) { method = m[1]; path = m[2]; }
      else {
        unresolved.push({
          kind: 'authz-endpoint-unparsed',
          file,
          detail: `entrada reconhecida como rota, com 'endpoint: ${String(e.endpoint).slice(0, 40)}' fora da forma 'VERBO /path'`,
        });
        continue;
      }
    }
    if (!path) continue;
    const policy = e.policy || e.rule || e.permission || null;
    // Entrada sem método não vira GET. Assumir o verbo é a mesma classe de defeito que o
    // route-scan condena para o path: se a rota real é POST, o SUR-01 bloqueia num `GET /x` que
    // ninguém prometeu, e o POST verdadeiro ainda aparece no SUR-02 como não declarado.
    if (!method) {
      unresolved.push({
        kind: 'authz-entry-without-method',
        file,
        detail: `'${path}' declarado sem método HTTP — assumir um verbo inventaria endpoint`,
      });
      continue;
    }
    out.push({ method, path, source: 'authz-map', file, policy });
  }
  return out;
}

// ── Fonte 2: OpenAPI ───────────────────────────────────────────────────────────────────────
// Lê o bloco `paths:` sem exigir parser completo — só o que interessa ao cruzamento. Aceita as
// duas serializações: um contrato em JSON era coletado e nunca parseado, e devolvia zero
// endpoints com o mesmo silêncio de um contrato inexistente.

/**
 * basePath de `servers[]`. Sem ele, um contrato que declara `servers: [{url: /api/v1}]` e
 * `paths: /widgets` produz `GET /widgets` — e o SUR-01, que bloqueia, acusa toda a superfície
 * de um contrato correto. Com mais de um basePath distinto, ou com variável de template, o
 * prefixo não é único: reporta e não aplica, em vez de escolher um.
 */
function serverPrefix(urls, file, unresolved) {
  const paths = (urls || [])
    .map((u) => String(u == null ? '' : u).trim())
    .map((u) => u.replace(/^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\/[^/]*/, ''))
    .filter((u) => u && u !== '/');
  const distintos = [...new Set(paths)];
  if (distintos.length === 0) return '';
  if (distintos.length > 1) {
    unresolved.push({
      kind: 'openapi-servers-ambiguous',
      file,
      detail: `servers[] declara ${distintos.length} basePaths distintos (${distintos.join(', ')}); nenhum foi aplicado`,
    });
    return '';
  }
  if (/\{[^{}]*\}/.test(distintos[0])) {
    unresolved.push({
      kind: 'openapi-servers-templated',
      file,
      detail: `servers[].url '${distintos[0]}' depende de variável de template; o basePath não foi aplicado`,
    });
    return '';
  }
  return distintos[0];
}

function fromOpenApiJson(text, file, unresolved) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    unresolved.push({ kind: 'contract-unparsed', file, detail: `JSON inválido: ${String(err && err.message).slice(0, 80)}` });
    return [];
  }
  if (!doc || typeof doc !== 'object' || !doc.paths || typeof doc.paths !== 'object') {
    unresolved.push({ kind: 'contract-without-paths', file, detail: 'documento OpenAPI sem bloco `paths` legível' });
    return [];
  }
  const prefix = serverPrefix(Array.isArray(doc.servers) ? doc.servers.map((s) => s && s.url) : [], file, unresolved);
  const out = [];
  for (const [p, item] of Object.entries(doc.paths)) {
    if (!item || typeof item !== 'object') continue;
    for (const [verb, op] of Object.entries(item)) {
      if (!HTTP_VERBS.includes(verb.toUpperCase())) continue;
      out.push({
        method: verb.toUpperCase(),
        path: joinPath(prefix, p),
        source: 'openapi',
        file,
        summary: (op && typeof op === 'object' && op.summary) || null,
      });
    }
  }
  return out;
}

function serversFromYaml(text) {
  const urls = [];
  let dentro = false;
  let base = -1;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const ind = line.length - line.trimStart().length;
    // Só o `servers` de nível raiz. `servers` dentro de um PathItem é OpenAPI 3.x válido, e
    // sem esta âncora ele entrava na mesma lista, virava "basePath ambíguo", e o prefixo da raiz
    // era descartado — SUR-01 acusando a superfície inteira de um contrato correto.
    if (ind === 0 && /^servers\s*:\s*$/.test(line.trim())) { dentro = true; base = ind; continue; }
    if (!dentro) continue;
    if (ind <= base) { dentro = false; continue; }
    const m = line.trim().match(/^-?\s*url\s*:\s*(.+)$/);
    if (m) urls.push(m[1].trim().replace(/^["']|["']$/g, ''));
  }
  return urls;
}

export function fromOpenApi(text, file = 'openapi', unresolved = []) {
  if (text.trim().startsWith('{')) return fromOpenApiJson(text, file, unresolved);

  const prefix = serverPrefix(serversFromYaml(text), file, unresolved);
  const out = [];
  const lines = text.split('\n');
  let inPaths = false;
  let pathsIndent = -1;
  let currentPath = null;
  let currentIndent = -1;
  // Rastreia quais chaves de path o leitor viu e quais chegaram a produzir verbo. A diferença é
  // extração PARCIAL, que sem diagnóstico é indistinguível de extração completa.
  const pathsSemVerbo = new Set();
  const comVerbo = new Set();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;

    if (/^paths\s*:\s*$/.test(line.trim())) { inPaths = true; pathsIndent = indent; continue; }
    if (!inPaths) continue;
    if (indent <= pathsIndent && line.trim() && !/^paths\s*:/.test(line.trim())) { inPaths = false; continue; }

    const pathMatch = line.trim().match(/^["']?(\/.*?)["']?\s*:\s*$/);
    if (pathMatch && (currentIndent === -1 || indent <= currentIndent)) {
      currentPath = pathMatch[1];
      currentIndent = indent;
      pathsSemVerbo.add(currentPath);
      continue;
    }
    // Chave de path que NÃO casou a forma de bloco: `/widgets: {get: {...}}` em flow style. O
    // leitor não abre o mapa inline, e sem este registro o path sumiria sem deixar rastro.
    if (/^["']?\//.test(line.trim()) && (currentIndent === -1 || indent <= currentIndent)) {
      pathsSemVerbo.add(line.trim().replace(/^["']?(\/[^"':\s]*).*$/, '$1'));
      continue;
    }
    if (!currentPath) continue;

    const verbMatch = line.trim().match(/^(get|post|put|delete|patch|head|options)\s*:\s*$/i);
    if (verbMatch && indent > currentIndent) {
      let summary = null;
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j += 1) {
        const sm = lines[j].trim().match(/^summary\s*:\s*(.+)$/);
        if (sm) { summary = sm[1].replace(/^["']|["']$/g, ''); break; }
      }
      comVerbo.add(currentPath);
      out.push({ method: verbMatch[1].toUpperCase(), path: joinPath(prefix, currentPath), source: 'openapi', file, line: i + 1, summary });
    }
  }
  if (!/^paths\s*:/m.test(text)) {
    unresolved.push({ kind: 'contract-without-paths', file, detail: 'documento sem bloco `paths` — nada a cruzar, e um contrato vazio não é o mesmo que contrato cumprido' });
    return out;
  }
  const semVerbo = [...pathsSemVerbo].filter((p) => !comVerbo.has(p));
  if (semVerbo.length) {
    unresolved.push({
      kind: 'contract-path-without-verb',
      file,
      detail: `${semVerbo.length} path(s) declarado(s) sem verbo extraído (${semVerbo.slice(0, 3).join(', ')}) — $ref de PathItem ou estilo inline que o leitor não abre`,
    });
  }
  if (out.length === 0) {
    unresolved.push({ kind: 'contract-paths-unparsed', file, detail: 'bloco `paths` presente e nenhum endpoint extraído — o leitor não entendeu a serialização' });
  }
  return out;
}

// ── Fonte 3: tabela endpoint → ação → recurso → policy (markdown do REQ-13) ────────────────
export function fromPolicyTable(text, file = 'requirements.md') {
  const out = [];
  const lines = text.split('\n');
  // Ancorado no heading da seção, como fromChecklist (LDG-0018.3). Sem âncora, QUALQUER tabela
  // markdown cuja primeira célula casasse `VERB /path` entrava na superfície DECLARADA — uma
  // tabela de "APIs de terceiros consumidas" fazia o SUR-01, que bloqueia, acusar o código por
  // não expor um endpoint que ele corretamente não expõe.
  //
  // Quando o heading NÃO existe, a varredura volta a ser ampla, de propósito: exigir o heading
  // faria a spec que escreveu o mapa sob outro título perder a superfície declarada inteira — e
  // superfície declarada vazia deixa o cruzamento verde por vacuidade, que é o defeito oposto e
  // pior. Degrada para o comportamento anterior e ANUNCIA (ver policyTableAnchored), nunca
  // emudece.
  const start = lines.findIndex((l) => /^#{1,6}\s*Mapa\s+endpoint\b/i.test(l));
  const ancorado = start !== -1;
  for (let i = ancorado ? start + 1 : 0; i < lines.length; i += 1) {
    if (ancorado && /^#{1,6}\s/.test(lines[i])) break;
    const row = lines[i];
    if (!row.trim().startsWith('|')) continue;
    const cells = row.split('|').map((c) => c.trim()).filter((c, idx, arr) => !(idx === 0 && !c) && !(idx === arr.length - 1 && !c));
    if (cells.length < 2) continue;
    if (/^-{2,}$/.test(cells[0].replace(/[:\s]/g, '-'))) continue;

    // Primeira célula no formato `GET /path` ou `` `GET /path` ``.
    const m = cells[0].replace(/`/g, '').trim().match(/^([A-Za-z]+)\s+(\/\S*)$/);
    if (!m || !HTTP_VERBS.includes(m[1].toUpperCase())) continue;
    const policy = cells.find((c, idx) => idx > 0 && /policy|permiss|scope/i.test(c)) || cells[cells.length - 1] || null;
    out.push({ method: m[1], path: m[2], source: 'table', file, line: i + 1, policy: policy && policy !== '—' ? policy : null });
  }
  return out;
}

/**
 * A tabela de policy deste texto está sob o heading canônico? Quem coleta usa para anunciar que
 * leu sem âncora — nesse modo uma tabela alheia (ex.: "APIs de terceiros consumidas") pode ter
 * entrado na superfície declarada, e quem lê o veredito precisa saber disso.
 */
export function policyTableAnchored(text) {
  return String(text || '').split('\n').some((l) => /^#{1,6}\s*Mapa\s+endpoint\b/i.test(l));
}

// ── Fonte 4: Checklist de cobertura de superfície ──────────────────────────────────────────
export function fromChecklist(text, file = 'requirements.md') {
  const out = [];
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^#{1,6}\s*Checklist de cobertura de superf[íi]cie\b/i.test(l));
  if (start === -1) return out;

  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,6}\s/.test(lines[i])) break;
    const row = lines[i];
    if (!row.trim().startsWith('|')) continue;
    const cells = row.split('|').map((c) => c.trim());
    // Coluna "Superfície" é a terceira do template; procura verbo+path em qualquer célula, porque
    // o preenchimento real varia ("POST /x", "endpoint POST /x", "`POST /x` no orquestrador").
    for (const cell of cells) {
      const m = cell.replace(/`/g, '').match(/\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/\S*)/i);
      if (!m) continue;
      out.push({ method: m[1], path: m[2].replace(/[.,;)]+$/, ''), source: 'checklist', file, line: i + 1 });
      break;
    }
  }
  return out;
}

// ── Coleta ─────────────────────────────────────────────────────────────────────────────────

function readIf(file) {
  try {
    if (!existsSync(file) || statSync(file).isDirectory()) return null;
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Une as quatro fontes num único conjunto de endpoints declarados.
 *
 * @param {object} opts
 * @param {string[]} opts.contractPaths  diretórios/arquivos de contrato (OpenAPI)
 * @param {string[]} opts.specPaths      arquivos de spec (tabela de policy, checklist)
 * @param {string[]} opts.authzPaths     arquivos de authz-map
 * @param {string}   opts.root           raiz para relativizar os paths reportados
 * @returns {{endpoints: Array, bySource: object}}
 */
export function collectDeclaredSurface({ contractPaths = [], specPaths = [], authzPaths = [], root = process.cwd() } = {}) {
  const map = new Map();
  const bySource = { 'authz-map': 0, openapi: 0, table: 0, checklist: 0 };
  const unresolved = [];
  const rel = (f) => relative(root, f) || f;

  // Valida a FONTE, não só o path. `existsSync` sozinho aprova o diretório de contratos vazio —
  // que é o estado normal de um change no início, e precisamente quando o SUR-01 precisa se
  // abster. Um path declarado do qual nada foi lido é indistinguível, para o cruzamento, de um
  // contrato que não promete nada.
  const declarado = (paths, exts, rotulo) => {
    for (const p of paths) {
      if (!existsSync(p)) {
        unresolved.push({
          kind: 'source-missing',
          file: rel(p),
          detail: `${rotulo} declarado e inexistente — contrato movido, renomeado ou com typo no wiring devolve superfície vazia, e superfície vazia deixa o SUR-01 verde por vacuidade`,
        });
        continue;
      }
      if (collect([p], { exts, skipDirs: DEFAULT_SKIP }).length === 0) {
        unresolved.push({
          kind: 'source-empty',
          file: rel(p),
          detail: `${rotulo} declarado e sem nenhum arquivo legível (${[...exts].join('/')}) — nada foi lido, e nada lido não é o mesmo que nada prometido`,
        });
      }
    }
  };
  const EXT_YAML = new Set(['.yaml', '.yml']);
  const EXT_CONTRATO = new Set(['.yaml', '.yml', '.json']);
  const EXT_SPEC = new Set(['.md']);
  declarado(authzPaths, EXT_YAML, 'authz-map');
  declarado(contractPaths, EXT_CONTRATO, 'contrato');
  declarado(specPaths, EXT_SPEC, 'spec');

  const ler = (f) => {
    const text = readIf(f);
    if (text === null) {
      unresolved.push({ kind: 'source-unreadable', file: rel(f), detail: 'arquivo declarado como fonte de superfície e não pôde ser lido' });
    }
    return text;
  };

  for (const f of collect(authzPaths, { exts: new Set(['.yaml', '.yml']), skipDirs: DEFAULT_SKIP })) {
    const text = ler(f);
    if (text === null) continue;
    for (const e of fromAuthzMap(text, rel(f), unresolved)) { upsert(map, e); bySource['authz-map'] += 1; }
  }

  for (const f of collect(contractPaths, { exts: new Set(['.yaml', '.yml', '.json']), skipDirs: DEFAULT_SKIP })) {
    const text = ler(f);
    if (text === null) continue;
    for (const e of fromOpenApi(text, rel(f), unresolved)) { upsert(map, e); bySource.openapi += 1; }
  }

  for (const f of collect(specPaths, { exts: new Set(['.md']), skipDirs: DEFAULT_SKIP })) {
    const text = ler(f);
    if (text === null) continue;
    const daTabela = fromPolicyTable(text, rel(f));
    if (daTabela.length && !policyTableAnchored(text)) {
      unresolved.push({
        kind: 'policy-table-unanchored',
        file: rel(f),
        line: 0,
        detail: 'tabela endpoint→policy lida sem o heading "## Mapa endpoint → ação → recurso → policy"; toda tabela do arquivo foi varrida, então uma tabela de APIs consumidas (não expostas) pode ter entrado na superfície declarada',
      });
    }
    for (const e of daTabela) { upsert(map, e); bySource.table += 1; }
    for (const e of fromChecklist(text, rel(f))) { upsert(map, e); bySource.checklist += 1; }
  }

  const endpoints = [...map.values()].sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
  return { endpoints, bySource, unresolved };
}

/**
 * SUR-01 — contrato→código: endpoint declarado que não existe como rota. BLOQUEIA.
 * É o defeito de "a promessa vive no contrato e ninguém a implementou".
 *
 * ── Por que existe veredito, e não só uma lista ────────────────────────────────────────────
 * O route-scan não emite path parcial: quando um prefixo não resolve (produtor homônimo ambíguo,
 * router sem mount conhecido, grupo com prefixo dinâmico), as rotas afetadas simplesmente não
 * saem e o caso vira `unresolved`. Isso é seguro para o SUR-02, onde a rota some e alguém olha —
 * mas é perigoso aqui, porque este check BLOQUEIA: um módulo inteiro cujas rotas foram suprimidas
 * faria o SUR-01 acusar todos os endpoints dele como não implementados, em massa e com cara de
 * veredito confiante.
 *
 * A regra é: o SUR-01 só pode afirmar "este endpoint não existe" sobre uma varredura em que o
 * scanner afirmou ter resolvido tudo. Havendo irresolúvel, ele devolve `inconclusive` e move os
 * ausentes para `abstained` — que é diferente de "nenhum achado" e não deve ser lido como verde.
 * Abster com escopo global é grosseiro de propósito: mapear endpoint→arquivo exigiria informação
 * que nenhuma das duas pontas tem, e a alternativa (adivinhar o escopo) reintroduziria o veredito
 * confiante sobre base incompleta que este desenho existe para impedir.
 *
 * @returns {{verdict: 'conclusive'|'inconclusive', findings: Array, abstained: Array, blockers: string[]}}
 */
export function surContractToCode(declared, routeKeySet, { unresolved = [] } = {}) {
  const ausentes = declared.filter((e) => !routeKeySet.has(`${e.method} ${e.path}`));

  // Kinds que comprovadamente NÃO reduzem o conjunto de rotas conhecidas. A lista é de exceções
  // explícitas, e o default é o oposto: kind desconhecido SUPRIME. Um diagnóstico novo que
  // alguém esqueça de classificar faz o gate se abster, nunca bloquear com base incompleta.
  const NAO_SUPRIME = new Set([]);
  const cegueira = unresolved.filter((u) => !NAO_SUPRIME.has(u.kind));

  if (cegueira.length === 0) {
    return { verdict: 'conclusive', findings: ausentes, abstained: [], blockers: [] };
  }
  return {
    verdict: 'inconclusive',
    findings: [],
    abstained: ausentes,
    blockers: [...new Set(cegueira.map((u) => u.kind))].sort(),
  };
}

/**
 * SUR-02 — código→contrato: rota que existe e nenhum artefato declara. `warn` por default.
 *
 * Agregado por prefixo de grupo porque legado inteiro sem contrato produz dezenas de achados
 * idênticos, e um gate que nasce com dezenas de achados é desligado no primeiro dia. A
 * allowlist cobre infra documentada (health, métricas, swagger), que não é superfície de
 * negócio e nunca esteve em contrato.
 */
export function surCodeToContract(routes, declaredKeySet, { allowlist = [] } = {}) {
  // Padrão em string é ancorado no início: allowlist é lista de PREFIXO de infra. Sem a âncora,
  // `'health'` silenciava `/v1/health-insurance/claims`, que é superfície de negócio.
  const allow = allowlist.map((p) => (p instanceof RegExp ? p : new RegExp(p.startsWith('^') ? p : `^${p}`)));
  const missing = routes.filter((r) => {
    if (declaredKeySet.has(`${r.method} ${r.path}`)) return false;
    return !allow.some((re) => re.test(r.path));
  });

  // O prefixo de agregação é o do GRUPO que registrou a rota, quando o scanner o conhece — ele
  // está no primeiro elo da cadeia (`MapGroup(/internal/v1/x)`). Contar segmentos fixos seria
  // arbitrário: `/legacy/v1/a` e `/internal/v1/orchestrator/vault/reveal` têm profundidades
  // diferentes e o mesmo conceito de "um grupo". Sem cadeia (dialeto de prefixo léxico), cai
  // nos dois primeiros segmentos, que é onde a versão/área costuma estar.
  const groupOf = (r) => {
    const fromChain = (r.chain || []).find((c) => /^MapGroup\(/.test(c));
    if (fromChain) return normalizePath(fromChain.slice('MapGroup('.length, -1));
    const segs = r.path.split('/').filter(Boolean);
    return segs.length ? `/${segs.slice(0, 2).join('/')}` : r.path;
  };

  const groups = new Map();
  for (const r of missing) {
    const prefix = groupOf(r);
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(r);
  }
  return [...groups.entries()]
    .map(([prefix, list]) => ({ prefix, count: list.length, routes: list }))
    .sort((a, b) => b.count - a.count || a.prefix.localeCompare(b.prefix));
}

/** Allowlist default: infra que nunca esteve em contrato de negócio. */
export const INFRA_ALLOWLIST = [
  /^\/health(\/|$)/,
  /^\/healthz(\/|$)/,
  /^\/metrics(\/|$)/,
  /^\/swagger(\/|$)/,
  /^\/openapi(\/|$)/,
  /^\/\.well-known(\/|$)/,
  /^\/favicon\.ico$/,
];
