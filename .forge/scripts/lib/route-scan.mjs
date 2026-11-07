#!/usr/bin/env node
// forge shared engine — route-scan. Zero-dependency.
//
// Extrai as rotas HTTP que o CÓDIGO de fato expõe, para que "o contrato promete um endpoint" e
// "o endpoint existe" possam ser comparados por script em vez de por leitura.
//
// ── Por que duas passadas, e não um scan por linha ──────────────────────────────────────────
// O `scan()` de source-scan.mjs casa padrão linha a linha, e uma rota real não cabe numa linha.
// No caso que motivou este módulo, o path final nasce de três arquivos e dois saltos:
//
//     Program.cs        var g = app.MapGroup("/internal/v1/orchestrator");  g.MapOrchestratorEndpoints();
//     Endpoints.cs      static X MapOrchestratorEndpoints(this RouteGroupBuilder group) { group.MapPost("/vault/reveal", ...) }
//
// Nenhuma linha contém `/internal/v1/orchestrator/vault/reveal`. Um scanner por linha vê o
// prefixo e vê o sufixo, e nunca vê a rota — o que faz o check passar em silêncio justamente
// onde a superfície é mais difícil de auditar a olho. Daí:
//
//   Passa 1 — indexa RAÍZES (prefixo literal ancorado num símbolo), PRODUTORES (função que
//             registra rotas sobre um grupo recebido) e INVOCAÇÕES (quem chama qual produtor).
//   Passa 2 — compõe transitivamente a partir de cada OWNER RAIZ, acumulando prefixo, até
//             esgotar. Cada folha vira uma rota com a cadeia que a produziu.
//
// ── Absoluto × relativo: a distinção que faz a composição fechar ────────────────────────────
// `MapX(this WebApplication app)` recebe a RAIZ da aplicação: um grupo aberto sobre `app` vale
// `/x` seja quem for que chame `MapX`. `MapY(this RouteGroupBuilder group)` recebe um grupo já
// prefixado: as rotas dele só têm path depois que se sabe QUEM o invocou. Tratar os dois iguais
// é o que fazia um subgrupo aberto dentro de um produtor relativo perder o prefixo do chamador
// e sair como `/invoices/{id}` no lugar de `/internal/v1/invoices/{id}`.
//
// ── Silêncio é proibido, e path inventado é pior que ausente ────────────────────────────────
// Duas invariantes, nesta ordem:
//   1. O que o scanner viu e não resolveu vira `unresolved` — nunca é descartado. Prefixo
//      irresolúvel que some faz o cruzamento passar por vacuidade, que é a mesma falha de
//      pré-requisito-ausente-vira-verde que o harness proíbe em todo gate.
//   2. Rota cujo prefixo o scanner não conseguiu compor NÃO é emitida com o path parcial. Um
//      path parcial não existe em runtime nenhum, e o SUR-01 — que bloqueia — daria veredito
//      confiante sobre ele. Ausente o SUR-02 acusa; inventado ninguém acusa.
import { readFileSync, existsSync } from 'node:fs';
import { relative } from 'node:path';
import { collect, DEFAULT_SKIP } from './source-scan.mjs';

export const ROUTE_EXTS = new Set(['.cs', '.java', '.kt', '.ts', '.js', '.mjs', '.py', '.go']);

const HTTP_VERBS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'];

// Métodos `Map<Nome>()` conhecidos que NÃO são produtor de rota definido pela APLICAÇÃO — ou são
// endpoint de INFRAESTRUTURA do próprio framework .NET (OpenAPI, métricas Prometheus, health
// checks, reflection gRPC, MVC attribute-routing), que este scanner não rastreia por design porque
// não é rota de NEGÓCIO que um contrato declararia, ou colidem por NOME com o padrão
// `Map<Capitalizado>()` sem ser rota nenhuma (`System.Net.IPAddress.MapToIPv4/MapToIPv6` do BCL).
// LDG-0029: medido no repositório de referência (axis-go-cloud, 2026-09-04), 100% dos 47
// `producer-not-found` daquela varredura eram exatamente estes nomes — nenhum produtor de
// aplicação genuinamente ausente. A lista é por NOME, o mesmo idioma já usado para excluir os
// verbos HTTP e `MapGroup` desta mesma checagem — o scanner não tem tipos, só léxico.
const KNOWN_NON_PRODUCER_CALLS = new Set([
  // ASP.NET Core — endpoints de infraestrutura do próprio framework, sem corpo de aplicação.
  'MapControllers', 'MapRazorPages', 'MapBlazorHub', 'MapOpenApi', 'MapSwagger',
  'MapPrometheusScrapingEndpoint', 'MapMetrics', 'MapGrpcReflectionService',
  // System.Net.IPAddress (BCL) — falso positivo por nome, não é registro de rota.
  'MapToIPv4', 'MapToIPv6',
]);

/** Tipos .NET que representam a RAIZ da aplicação, não um grupo já prefixado. */
const ROOT_BUILDER_TYPES = /^(WebApplication|IEndpointRouteBuilder)$/;

/**
 * Forma canônica de um path de rota, para que duas grafias do mesmo endpoint comparem iguais.
 *
 * Sem isto o cruzamento contrato↔código produz falso positivo imediato: o contrato escreve
 * `/blocks/{terminal}/{sequence}` e o código escreve `/blocks/{terminal}/{sequence:long}`, que
 * são o mesmo endpoint e strings diferentes. As três normalizações:
 *
 *   - constraint de rota some       `{sequence:long}`  → `{}`
 *   - nome de parâmetro some        `{id}` `:id` `<id>` → `{}`   (o nome é do autor, não do contrato)
 *   - barra final e barras duplas   `/a//b/`           → `/a/b`
 */
export function normalizePath(path) {
  if (typeof path !== 'string') return '';
  let p = path.trim();
  if (!p) return '';

  // Chaves: `{id}`, `{id:long}`, `{*rest}`, `{id?}` — tudo vira `{}`.
  p = p.replace(/\{[^{}]*\}/g, '{}');
  // Express/Ktor/Spring por dois-pontos: `/users/:id` → `/users/{}`.
  p = p.replace(/(^|\/):[^/]+/g, '$1{}');
  // Go chi / templates angulares: `/users/<id>` → `/users/{}`.
  p = p.replace(/<[^<>]*>/g, '{}');
  // Curinga de sufixo vira parâmetro — `*` sozinho não distingue endpoint.
  p = p.replace(/(^|\/)\*+(?=$|\/)/g, '$1{}');

  p = p.replace(/\/{2,}/g, '/');
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p;
}

/** Junta prefixo e sufixo já normalizando — `join('/a/', '/b')` e `join('/a', 'b')` dão `/a/b`. */
export function joinPath(prefix, suffix) {
  const a = (prefix || '').trim();
  const b = (suffix || '').trim();
  if (!a) return normalizePath(b);
  if (!b || b === '/') return normalizePath(a);
  return normalizePath(`${a}/${b}`);
}

// ── extração de literal ────────────────────────────────────────────────────────────────────
// Aceita aspas simples, duplas, template literal e verbatim string do C#. Literal COM
// interpolação é deliberadamente recusado, em QUALQUER das duas formas em que ela aparece:
//
//   prefixo da aspa   C#            `$"..."`, `$@"..."`, `@$"..."`
//   dentro da aspa    JS/TS/Kotlin  `` `${base}/users` ``, Kotlin `"$API_BASE/payments"`
//
// A segunda forma é a que mais importa na prática: prefixo em variável é o idioma padrão de
// Express, Fastify e Ktor. Aceitar o texto entre aspas produz `/${}/users`, que não é rota de
// lugar nenhum — e o SUR-01, que bloqueia, compararia o contrato contra ela.
function literal(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();

  // O reconhecimento do literal e a DECISÃO sobre interpolação ficam separados de propósito. O
  // regex aceita todos os prefixos que o C# admite (`@`, `$`, `$@`, `@$`) e captura o conteúdo;
  // quem recusa são as linhas abaixo, sozinhas. Defesa dupla aqui foi um problema real: enquanto
  // o regex também barrava o interpolado, mutar a regra não mudava comportamento nenhum, e a
  // prova de mutação não conseguia matar a mutação — um teste que não pode falhar não é teste.
  const m = s.match(/^(@\$|\$@|[@$])?(["'`])([^"'`]*)\2$/);
  if (!m) return null;

  const prefixo = m[1] || '';
  if (prefixo.includes('$')) return null;

  const conteudo = m[3];
  // `${...}` cobre template literal de JS/TS e interpolação de expressão do Kotlin; `$ident`
  // cobre a forma curta do Kotlin. `$5` e `$` sozinho não são interpolação e passam.
  if (/\$\{/.test(conteudo)) return null;
  if (/\$[A-Za-z_]/.test(conteudo)) return null;

  return conteudo;
}

/**
 * Varre o arquivo uma vez e devolve duas projeções do MESMO comprimento, para que todo índice
 * valha nas duas:
 *
 *   code    comentários viram espaço. É onde os regexes de indexação leem os literais de path.
 *   struct  comentários E o conteúdo das strings viram espaço. É onde as chaves são contadas.
 *
 * A separação existe porque contar chaves sobre o texto cru é indefensável. Um `//` dentro de uma
 * URL literal (`new Uri("https://api.acme.com/")`) fazia o removedor de comentário levar junto o
 * `}` da mesma linha; uma chave dentro de string (`const string Tmpl = "{";`) desbalanceava
 * diretamente. Nos dois casos o corpo da classe deixava de fechar, a classe era descartada, e as
 * rotas dela saíam SEM prefixo e sem diagnóstico — path inventado pela via mais silenciosa que
 * existe. Mascarar o conteúdo das strings preservando as posições resolve os dois de uma vez.
 */
export function project(raw) {
  const code = raw.split('');
  const struct = raw.split('');
  const n = raw.length;
  const branco = (arr, i) => { if (raw[i] !== '\n') arr[i] = ' '; };

  let i = 0;
  while (i < n) {
    const c = raw[i];
    const d = raw[i + 1];

    if (c === '/' && d === '/') {
      while (i < n && raw[i] !== '\n') { branco(code, i); branco(struct, i); i += 1; }
      continue;
    }
    if (c === '/' && d === '*') {
      const fim = raw.indexOf('*/', i + 2);
      const parar = fim === -1 ? n : fim + 2;
      for (; i < parar; i += 1) { branco(code, i); branco(struct, i); }
      continue;
    }
    // `#` de comentário (Python, e `#region` do C#, inofensivo aqui). `#[` é atributo de Rust.
    if (c === '#' && d !== '[' && (i === 0 || /\s/.test(raw[i - 1]))) {
      while (i < n && raw[i] !== '\n') { branco(code, i); branco(struct, i); i += 1; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      // Verbatim do C# (`@"..."`, `$@"..."`, `@$"..."`): a barra invertida NÃO escapa nada; o
      // escape é a aspa duplicada. Tratá-la como escape fazia um path do Windows terminado em
      // barra (`@"\\srv\share\"`, idioma dominante) consumir a aspa de fechamento e seguir
      // "dentro da string", branqueando o código real até a próxima aspa — as chaves do corpo da
      // classe sumiam e o prefixo evaporava, sem diagnóstico.
      const verbatim = c === '"' && (raw[i - 1] === '@' || (raw[i - 1] === '$' && raw[i - 2] === '@'));
      i += 1;
      while (i < n) {
        if (verbatim) {
          if (raw[i] === '"' && raw[i + 1] === '"') { branco(struct, i); branco(struct, i + 1); i += 2; continue; }
          if (raw[i] === '"') break;
        } else {
          // O guard `i + 1 < n` mantém a invariante de comprimento: escrever em `struct[n]`
          // estenderia o array numa string não terminada em `\`.
          if (raw[i] === '\\' && i + 1 < n) { branco(struct, i); branco(struct, i + 1); i += 2; continue; }
          if (raw[i] === c) break;
        }
        branco(struct, i);
        i += 1;
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  return { code: code.join(''), struct: struct.join('') };
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

/**
 * Extrai o corpo de um bloco `{...}` balanceado a partir da posição do `{`.
 * Devolve `{body, end}` ou `null` quando as chaves não fecham (arquivo truncado).
 */
function blockAt(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const c = text[i];
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return { body: text.slice(openIndex + 1, i), start: openIndex + 1, end: i };
    }
  }
  return null;
}

/**
 * Classes do arquivo com o intervalo do corpo, para atribuir cada atributo à sua classe.
 *
 * Classe SEM corpo (`data class OrderDto(val id: Long)` do Kotlin, a forma dominante lá) não tem
 * `{` próprio: procurar a próxima chave acharia a de abertura da classe SEGUINTE, e as duas
 * passariam a compartilhar o mesmo intervalo. O desempate por classe mais interna daria a vitória
 * à DTO, que não tem `@RequestMapping`, e o prefixo do controller sumiria — path inventado, e
 * intermitente conforme a ordem das declarações no arquivo.
 */
function classesOf(text) {
  const decls = [];
  const re = /\bclass\s+(\w+)/g;
  for (let m; (m = re.exec(text)); ) {
    // `where TDto : class` é RESTRIÇÃO genérica, não declaração. Sem este corte o regex casava
    // um fantasma chamado `where`, que se interpõe entre o controller e o `{` do corpo dele — e
    // com o limite por próxima-declaração isso descartava o controller de verdade, transferindo
    // o `[Route]` (e a resolução de `[controller]`) para o fantasma.
    const antes = text.slice(0, m.index).trimEnd();
    if (antes.endsWith(':') || antes.endsWith(',')) continue;
    decls.push({ name: m[1], declIndex: m.index, after: m.index + m[0].length });
  }

  const out = [];
  decls.forEach((d, i) => {
    const limite = i + 1 < decls.length ? decls[i + 1].declIndex : text.length;
    const open = text.indexOf('{', d.after);
    if (open === -1 || open >= limite) return;
    const blk = blockAt(text, open);
    if (!blk) return;
    out.push({ name: d.name, declIndex: d.declIndex, start: blk.start, end: blk.end });
  });
  return out;
}

/**
 * Último atributo `[Nome(...)]` / `@Nome(...)` entre `from` e a declaração.
 *
 * A janela vai do fim da classe ANTERIOR até esta declaração, não um número fixo de caracteres.
 * Uma janela por contagem erra dos dois lados: curta demais, o `[Route]` de um controller com o
 * conjunto normal de atributos (`[Produces]`, `[Authorize]`, dois `[ProducesResponseType]`) cai
 * fora e o prefixo evapora; longa demais, uma classe sem `[Route]` herda o da classe anterior e
 * ganha um prefixo que não é dela.
 */
function attrBefore(text, from, to, pattern) {
  const win = text.slice(Math.max(0, from), to);
  let last = null;
  pattern.lastIndex = 0;
  for (let m; (m = pattern.exec(win)); ) last = m[1];
  pattern.lastIndex = 0;
  return last;
}

/** Encontra a classe mais interna que contém o índice. */
function containerOf(classes, index) {
  let best = null;
  for (const c of classes) {
    if (index > c.start && index < c.end && (!best || c.start > best.start)) best = c;
  }
  return best;
}

/**
 * Argumento de path de uma anotação Spring, que raramente vem sozinho.
 * `("/x")`, `(value = "/x", produces = "…")`, `(path = "/x")`, `({"/x", "/y"})`.
 */
function springPath(raw) {
  const s = String(raw == null ? '' : raw);
  const nomeado = s.match(/\b(?:value|path)\s*=\s*\{?\s*(["'][^"']*["'])/);
  if (nomeado) return literal(nomeado[1]);
  const array = s.match(/^\s*\{\s*(["'][^"']*["'])/);
  if (array) return literal(array[1]);
  if (/=/.test(s)) return null;
  return literal(s);
}

// ── Passa 1: indexação por dialeto ─────────────────────────────────────────────────────────

/**
 * Registra a cadeia `x.MapGroup("/a").MapGroup("/b")` como grupos encadeados e devolve o id do
 * último elo. Um `MapGroup` encadeado sem isto perderia todos os segmentos menos o primeiro.
 * Elo cujo path não é literal entra com `path: null` — o grupo existe, o prefixo não se sabe, e
 * a composição para ali em vez de emitir path parcial.
 */
function pushGroupChain(idx, { scope, symbol, parentId, chainSrc, file, line, truncada = false }) {
  const segs = [...chainSrc.matchAll(/\.\s*MapGroup\s*\(\s*([^)]*?)\s*\)/g)].map((x) => x[1]);
  let parent = parentId;
  segs.forEach((raw, i) => {
    const last = i === segs.length - 1;
    const id = last ? `${scope}:${symbol}` : `${scope}:${symbol}#elo${i}`;
    let lit = literal(raw);
    if (lit === null) {
      idx.unresolved.push({ kind: 'group-path-not-literal', file, line, detail: raw.slice(0, 60) });
    }
    // Cadeia com elo fora do alcance do reconhecedor: o último elo carrega a incerteza, para que
    // nenhuma rota pendurada nele saia com o prefixo pela metade.
    if (last && truncada) lit = null;
    idx.groups.push({ id, scope, symbol, parent, path: lit, file, line });
    parent = id;
  });
  return parent;
}

/**
 * .NET minimal API. Reconhece raiz, produtor, rota, invocação e cadeia fluente.
 *
 * O escopo de um símbolo é o CORPO da função, nunca o nome isolado: praticamente todo produtor
 * chama seu parâmetro de `group`, e indexar por nome global faria as rotas de um produtor
 * aparecerem penduradas em todos os outros. O índice de PRODUTORES é por nome — é assim que a
 * invocação os encontra —, mas guarda TODAS as definições homônimas: com mais de uma, o scanner
 * não sabe qual delas a invocação alcança e reporta `producer-ambiguous` em vez de escolher.
 * Escolher (o comportamento anterior, em que a última definição lida sobrescrevia as outras)
 * emitia rota cruzada entre módulos e perdia a rota real, sem nenhum diagnóstico.
 */
// Escopo de resolução do C#: o namespace declarado no arquivo e os `using` visíveis nele. É o que
// permite desambiguar um produtor homônimo (LDG-0019): no convênio de vertical slice, N features
// declaram `MapEndpoints` e o compilador sabe qual é a certa pelo `using` de quem invoca — essa
// informação está no texto, e ignorá-la custava a cobertura inteira do layout.
// `using var x = ...` e `using (...)` são declaração de recurso, não import, e ficam de fora pela
// exigência de que o alvo seja um nome pontuado terminado em `;`.
function csScope(text) {
  let ns = '';
  const mFile = text.match(/^\s*namespace\s+([\w.]+)\s*;/m);
  const mBlock = text.match(/^\s*namespace\s+([\w.]+)\s*\{/m);
  if (mFile) ns = mFile[1];
  else if (mBlock) ns = mBlock[1];
  const usings = new Set();
  const globals = new Set();
  const re = /^\s*(global\s+)?using\s+(?:static\s+)?([\w.]+)\s*;/gm;
  for (let m; (m = re.exec(text)); ) (m[1] ? globals : usings).add(m[2]);
  return { ns, usings, globals };
}

function indexDotnetMinimal(text, struct, file, idx) {
  // Match que começa dentro de um literal não é código: `@"app.MapGet(""/x"", H);"` é template de
  // source generator, não registro de rota.
  const emLiteral = (i) => struct[i] !== text[i];
  const escopo = csScope(text);
  idx.csScope.set(file, escopo);
  for (const g of escopo.globals) idx.csGlobalUsings.add(g);
  const rotasAntes = idx.routes.length + idx.absolute.length;
  const sitiosGrupo = [];
  { const re = /\.\s*MapGroup\s*\(/g; for (let m; (m = re.exec(struct)); ) sitiosGrupo.push(m.index); }
  const ancorados = new Set();
  const ancorar = (de, ate) => { for (const i of sitiosGrupo) if (i >= de && i < ate) ancorados.add(i); };
  const sitiosVerbo = (struct.match(/\.\s*Map(?:Get|Post|Put|Delete|Patch|Head|Options)\s*\(/g) || []).length;

  const producerRe = /\b(?:public|internal|private|protected)?\s*static\s+[\w<>,.\[\]?]+\s+(\w+)\s*(?:<[^<>()]*>)?\s*\(\s*(?:this\s+)?(IEndpointRouteBuilder|RouteGroupBuilder|WebApplication)\s+(\w+)[^)]*\)/g;
  const producerBodies = [];
  for (let m; (m = producerRe.exec(text)); ) {
    const open = struct.indexOf('{', m.index + m[0].length);
    if (open === -1) continue;
    const blk = blockAt(struct, open);
    if (!blk) continue;
    const [, name, type, param] = m;
    const scope = `${file}#${name}`;
    push(idx.producers, name, {
      name,
      scope,
      param,
      ns: escopo.ns,
      rootLike: ROOT_BUILDER_TYPES.test(type),
      file,
      line: lineOf(text, m.index),
    });
    producerBodies.push({ scope, param, start: blk.start, end: blk.end });
  }

  // Um índice pertence ao produtor mais interno que o contém; fora de todos, ao escopo do arquivo.
  const scopeAt = (index) => {
    let best = null;
    for (const b of producerBodies) {
      if (index > b.start && index < b.end && (!best || b.start > best.start)) best = b;
    }
    return best ? best.scope : `${file}#<top>`;
  };

  const CHAIN = '(?:\\s*\\.\\s*MapGroup\\s*\\(\\s*[^)]*?\\s*\\))+';

  const groupRe = new RegExp(`(?:var|RouteGroupBuilder)\\s+(\\w+)\\s*=\\s*(\\w+)(${CHAIN})([^;]*)`, 'g');
  for (let m; (m = groupRe.exec(text)); ) {
    const [, symbol, parent, chainSrc, resto] = m;
    if (emLiteral(m.index)) continue;
    const scope = scopeAt(m.index);
    const line = lineOf(text, m.index);
    const perdido = /\.\s*MapGroup\s*\(/.test(resto || '');
    const fimCadeia = m.index + m[0].length - (resto || '').length;
    ancorar(fimCadeia - chainSrc.length, fimCadeia);
    pushGroupChain(idx, { scope, symbol, parentId: `${scope}:${parent}`, chainSrc, file, line, truncada: perdido });
  }

  // Atribuição que CONTÉM MapGroup mas cuja cadeia o padrão estrito não ancora
  // (`var b = Helper.Build().MapGroup("/b")`). O símbolo é um grupo de prefixo desconhecido, não
  // uma raiz: sem registrá-lo, as rotas dele eram promovidas a absolutas e saíam sem prefixo.
  const groupFrouxoRe = /(?:var|RouteGroupBuilder)\s+(\w+)\s*=\s*[^;]*?\.\s*MapGroup\s*\([^;]*/g;
  for (let m; (m = groupFrouxoRe.exec(text)); ) {
    if (emLiteral(m.index)) continue;
    const scope = scopeAt(m.index);
    const id = `${scope}:${m[1]}`;
    if (idx.groups.some((g) => g.id === id)) continue;
    idx.groups.push({ id, scope, symbol: m[1], parent: `${scope}:<desconhecido>`, path: null, file, line: lineOf(text, m.index) });
  }

  // Cadeia fluente sem atribuição: `app.MapGroup("/x").MapGet("/y", H)` e
  // `app.MapGroup("/x").MapTokenEndpoints()`. Sem isto o registro é INVISÍVEL — o receptor do
  // verbo passa a ser `)`, que não casa `\w+`, e nem rota nem `unresolved` saíam.
  let fluentSeq = 0;
  for (const verb of HTTP_VERBS) {
    const cap = verb[0].toUpperCase() + verb.slice(1);
    const re = new RegExp(`\\b(\\w+)(${CHAIN})\\s*\\.\\s*Map${cap}\\s*\\(\\s*([^,)]*)`, 'g');
    for (let m; (m = re.exec(text)); ) {
      if (emLiteral(m.index)) continue;
      const [, recv, chainSrc, rawPath] = m;
      const scope = scopeAt(m.index);
      const line = lineOf(text, m.index);
      ancorar(m.index + recv.length, m.index + recv.length + chainSrc.length);
      fluentSeq += 1;
      const ownerId = pushGroupChain(idx, { scope, symbol: `#fluente${fluentSeq}`, parentId: `${scope}:${recv}`, chainSrc, file, line });
      const lit = literal(rawPath);
      if (lit === null) {
        idx.unresolved.push({ kind: 'route-path-not-literal', file, line, detail: rawPath.slice(0, 60) });
        continue;
      }
      idx.routes.push({ owner: ownerId, method: verb.toUpperCase(), path: lit, file, line });
    }
  }
  const fluentCallRe = new RegExp(`\\b(\\w+)(${CHAIN})\\s*\\.\\s*(Map[A-Z]\\w*)\\s*\\(\\s*\\)`, 'g');
  for (let m; (m = fluentCallRe.exec(text)); ) {
    const [, recv, chainSrc, producer] = m;
    if (/^Map(Get|Post|Put|Delete|Patch|Head|Options|Group)$/.test(producer)) continue;
    if (KNOWN_NON_PRODUCER_CALLS.has(producer)) continue;
    const scope = scopeAt(m.index);
    const line = lineOf(text, m.index);
    ancorar(m.index + recv.length, m.index + recv.length + chainSrc.length);
    fluentSeq += 1;
    const ownerId = pushGroupChain(idx, { scope, symbol: `#fluente${fluentSeq}`, parentId: `${scope}:${recv}`, chainSrc, file, line });
    idx.calls.push({ owner: ownerId, producer, file, line });
  }

  for (const verb of HTTP_VERBS) {
    const cap = verb[0].toUpperCase() + verb.slice(1);
    const re = new RegExp(`(\\w+)\\s*\\.\\s*Map${cap}\\s*\\(\\s*([^,)]*)`, 'g');
    for (let m; (m = re.exec(text)); ) {
      if (emLiteral(m.index)) continue;
      const lit = literal(m[2]);
      const scope = scopeAt(m.index);
      if (lit === null) {
        idx.unresolved.push({ kind: 'route-path-not-literal', file, line: lineOf(text, m.index), detail: m[2].slice(0, 60) });
        continue;
      }
      idx.routes.push({ owner: `${scope}:${m[1]}`, method: verb.toUpperCase(), path: lit, file, line: lineOf(text, m.index) });
    }
  }

  const callRe = /(\w+)\s*\.\s*(Map[A-Z]\w*)\s*\(\s*\)/g;
  for (let m; (m = callRe.exec(text)); ) {
    if (emLiteral(m.index)) continue;
    if (/^Map(Get|Post|Put|Delete|Patch|Head|Options|Group)$/.test(m[2])) continue;
    if (KNOWN_NON_PRODUCER_CALLS.has(m[2])) continue;
    idx.calls.push({ owner: `${scopeAt(m.index)}:${m[1]}`, producer: m[2], file, line: lineOf(text, m.index) });
  }

  const orfaos = sitiosGrupo.filter((i) => !ancorados.has(i));
  if (orfaos.length) {
    idx.unresolved.push({
      kind: 'mapgroup-unindexed',
      file,
      line: lineOf(text, orfaos[0]),
      detail: `${orfaos.length} chamada(s) MapGroup() que o scanner não conseguiu ancorar (elo não adjacente, receptor composto); o prefixo delas não entra em rota nenhuma`,
    });
  }
  const rotasVistas = idx.routes.length + idx.absolute.length - rotasAntes;
  const naoLiterais = idx.unresolved.filter((u) => u.file === file && u.kind === 'route-path-not-literal').length;
  if (rotasVistas + naoLiterais < sitiosVerbo) {
    idx.unresolved.push({
      kind: 'route-site-unindexed',
      file,
      line: 0,
      detail: `${sitiosVerbo - rotasVistas - naoLiterais} registro(s) de verbo HTTP que o scanner não conseguiu ancorar a um receptor conhecido`,
    });
  }
}

/**
 * .NET com atributos: `[Route("api/[controller]")]` na classe + `[HttpGet("{id}")]` no método.
 *
 * O prefixo é resolvido POR CLASSE, pela posição do atributo dentro do corpo. Usar "o prefixo do
 * arquivo, se houver exatamente um" fazia dois controllers no mesmo `.cs` descartarem os dois
 * prefixos e emitirem `/list` no lugar de `/api/alpha/list` — path inventado, sem diagnóstico.
 */
function indexDotnetAttributes(text, struct, file, idx) {
  const classes = classesOf(struct);
  const prefixes = new Map();
  classes.forEach((c, i) => {
    const desde = i > 0 ? classes[i - 1].end : 0;
    const raw = attrBefore(text, desde, c.declIndex, /\[\s*Route\s*\(\s*([^)]*?)\s*\)\s*\]/g);
    if (raw === null) { prefixes.set(c.name, { path: '', ok: true }); return; }
    const lit = literal(raw);
    if (lit === null) {
      idx.unresolved.push({ kind: 'class-route-not-literal', file, line: lineOf(text, c.declIndex), detail: raw.slice(0, 60) });
      prefixes.set(c.name, { path: '', ok: false });
      return;
    }
    // `[controller]` é substituído pelo nome da classe sem o sufixo Controller, em MINÚSCULO
    // (LDG-0018.1). O roteamento do ASP.NET é case-insensitive, então `/api/Orders` e
    // `/api/orders` são o mesmo endpoint — mas o contrato costuma escrever minúsculo, e o SUR-01,
    // que bloqueia, acusaria por diferença de caixa um endpoint que existe.
    //
    // O case-fold é DAQUI, não do normalizePath: Spring e Express são case-sensitive e usam o
    // mesmo normalizador, então rebaixar caixa lá faria dois endpoints distintos colidirem.
    // Também não se aplica ao resto do path: só o token substituído é derivado do nome da classe
    // (uma decisão de C#, não do autor da rota) — `[Route("api/V2/[controller]")]` preserva o V2.
    prefixes.set(c.name, { path: lit.replace(/\[controller\]/gi, c.name.replace(/Controller$/, '').toLowerCase()), ok: true });
  });

  for (const verb of HTTP_VERBS) {
    const cap = verb[0].toUpperCase() + verb.slice(1);
    const re = new RegExp(`\\[\\s*Http${cap}\\s*(?:\\(\\s*([^)]*?)\\s*\\))?\\s*\\]`, 'g');
    for (let m; (m = re.exec(text)); ) {
      const line = lineOf(text, m.index);
      const owner = containerOf(classes, m.index);
      const pref = owner ? prefixes.get(owner.name) : { path: '', ok: true };
      const lit = m[1] === undefined ? '' : literal(m[1]);
      if (m[1] !== undefined && lit === null) {
        idx.unresolved.push({ kind: 'route-path-not-literal', file, line, detail: String(m[1]).slice(0, 60) });
        continue;
      }
      if (!pref || !pref.ok) {
        idx.unresolved.push({ kind: 'route-prefix-unresolved', file, line, detail: `[Http${cap}] em classe cujo [Route] não é literal — prefixo desconhecido` });
        continue;
      }
      idx.absolute.push({ method: verb.toUpperCase(), path: joinPath(pref.path, lit || ''), file, line });
    }
  }
}

/**
 * Spring: `@RequestMapping("/x")` na classe + `@GetMapping("/y")` no método.
 *
 * Também por classe, e pelo mesmo motivo: pegar só o primeiro `@RequestMapping` do arquivo
 * aplicava o prefixo de uma classe às rotas de todas as outras. Em `.kt`, onde várias classes
 * por arquivo é a norma, isso trocava o prefixo de metade das rotas.
 */
function indexSpring(text, struct, file, idx) {
  const classes = classesOf(struct);
  const prefixes = new Map();
  classes.forEach((c, i) => {
    const desde = i > 0 ? classes[i - 1].end : 0;
    const raw = attrBefore(text, desde, c.declIndex, /@RequestMapping\s*\(\s*([^)]*?)\s*\)/g);
    if (raw === null) { prefixes.set(c.name, { path: '', ok: true }); return; }
    const lit = springPath(raw);
    if (lit === null) {
      idx.unresolved.push({ kind: 'class-route-not-literal', file, line: lineOf(text, c.declIndex), detail: raw.slice(0, 60) });
      prefixes.set(c.name, { path: '', ok: false });
      return;
    }
    prefixes.set(c.name, { path: lit, ok: true });
  });

  // `@RequestMapping(..., method=RequestMethod.GET)` dentro do corpo de uma classe é registro de
  // rota como qualquer `@GetMapping`. Sem isto ele não virava rota NEM irresolúvel.
  const metodoRe = /@RequestMapping\s*\(\s*([^)]*?)\s*\)/g;
  for (let m; (m = metodoRe.exec(text)); ) {
    const owner = containerOf(classes, m.index);
    if (!owner) continue;
    const line = lineOf(text, m.index);
    const verbos = [...String(m[1]).matchAll(/RequestMethod\s*\.\s*(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/g)].map((x) => x[1]);
    if (verbos.length === 0) continue;
    const pref = prefixes.get(owner.name);
    const lit = springPath(m[1]);
    if (lit === null) {
      idx.unresolved.push({ kind: 'route-path-not-literal', file, line, detail: String(m[1]).slice(0, 60) });
      continue;
    }
    if (!pref || !pref.ok) {
      idx.unresolved.push({ kind: 'route-prefix-unresolved', file, line, detail: '@RequestMapping em classe cujo prefixo não resolveu' });
      continue;
    }
    for (const v of verbos) idx.absolute.push({ method: v, path: joinPath(pref.path, lit), file, line });
  }

  for (const verb of HTTP_VERBS) {
    const cap = verb[0].toUpperCase() + verb.slice(1);
    const re = new RegExp(`@${cap}Mapping\\s*(?:\\(\\s*([^)]*?)\\s*\\))?`, 'g');
    for (let m; (m = re.exec(text)); ) {
      const line = lineOf(text, m.index);
      const owner = containerOf(classes, m.index);
      const pref = owner ? prefixes.get(owner.name) : { path: '', ok: true };
      const lit = m[1] === undefined ? '' : springPath(m[1]);
      if (m[1] !== undefined && lit === null) {
        idx.unresolved.push({ kind: 'route-path-not-literal', file, line, detail: String(m[1]).slice(0, 60) });
        continue;
      }
      if (!pref || !pref.ok) {
        idx.unresolved.push({ kind: 'route-prefix-unresolved', file, line, detail: `@${cap}Mapping em classe cujo @RequestMapping não é literal — prefixo desconhecido` });
        continue;
      }
      idx.absolute.push({ method: verb.toUpperCase(), path: joinPath(pref.path, lit || ''), file, line });
    }
  }
}

/**
 * Ktor: `route("/x") { get("/y") { ... } }` — aninhamento léxico define o prefixo.
 * Rastreia profundidade de chaves para saber qual `route` ainda está aberto.
 *
 * Frame com prefixo irresolúvel CONTAMINA os descendentes: as rotas abaixo dele não são
 * emitidas, porque sairiam sem o prefixo — `/status` no lugar de `/{basePath}/status`.
 */
function indexKtor(text, struct, file, idx) {
  // `route(` que o padrão principal não casa (argumento com parênteses, p.ex. `route(base())`)
  // não empilha frame nenhum, e as rotas de dentro sairiam sem prefixo. Contadas aqui para que
  // a diferença vire diagnóstico em vez de path parcial.
  const totalRoute = (struct.match(/\broute\s*\(/g) || []).length;
  let casados = 0;

  const tokens = [];
  const re = /\broute\s*\(\s*([^)]*?)\s*\)\s*\{|\b(get|post|put|delete|patch|head|options)\s*\(\s*([^)]*?)\s*\)\s*\{|\b(get|post|put|delete|patch|head|options)\s*\{|\{|\}/g;
  const stack = [];
  // Handlers abertos: um verbo COM path abre um corpo de resposta, e o que estiver lá dentro é
  // conteúdo, não roteamento. É o que distingue `route { authenticate { get {} } }` — legítimo —
  // de `get("/p") { respondHtml { head {} } }`, onde `head` é DSL do kotlinx.html e virava rota
  // fantasma. A profundidade sozinha não separava os dois e descartava o primeiro.
  const handlers = [];
  let depth = 0;
  for (let m; (m = re.exec(text)); ) {
    // Nada que venha de dentro de um literal conta: nem chave, nem `route(`, nem verbo. Numa raw
    // string do Kotlin com exemplo de DSL, o match fantasma emitia rota E a rota real herdava o
    // prefixo da falsa.
    if (struct[m.index + m[0].length - 1] !== m[0][m[0].length - 1]) continue;
    if (m[0] === '{') { depth += 1; continue; }
    if (m[0] === '}') {
      depth -= 1;
      while (stack.length && stack[stack.length - 1].depth > depth) stack.pop();
      while (handlers.length && handlers[handlers.length - 1] > depth) handlers.pop();
      continue;
    }
    if (m[1] !== undefined) {
      casados += 1;
      const lit = literal(m[1]);
      depth += 1;
      if (lit === null) {
        idx.unresolved.push({ kind: 'group-path-not-literal', file, line: lineOf(text, m.index), detail: m[1].slice(0, 60) });
        stack.push({ path: '', depth, unresolved: true });
      } else {
        stack.push({ path: lit, depth, unresolved: false });
      }
      continue;
    }
    // `get { }` sem path só conta quando está DIRETAMENTE dentro de um route() aberto. Fora de
    // route() é getter de propriedade do Kotlin; vários níveis abaixo é DSL cujo nome coincide
    // com verbo — `call.respondHtml { head { ... } }` do kotlinx.html emitia um `HEAD /x`
    // fantasma, que o SUR-02 acusaria como rota não declarada.
    if (m[4] !== undefined && (stack.length === 0 || handlers.length > 0)) {
      depth += 1;
      continue;
    }
    if (m[2] !== undefined || m[4] !== undefined) {
      const verbo = m[2] !== undefined ? m[2] : m[4];
      const lit = m[2] !== undefined ? (literal(m[3]) ?? '') : '';
      depth += 1;
      handlers.push(depth);
      const line = lineOf(text, m.index);
      if (stack.some((s) => s.unresolved)) {
        idx.unresolved.push({ kind: 'route-prefix-unresolved', file, line, detail: `${verbo}('${lit}') sob route() com prefixo irresolúvel — path parcial não é emitido` });
        continue;
      }
      const prefix = stack.map((s) => s.path).join('/');
      tokens.push({ method: verbo.toUpperCase(), path: joinPath(prefix, lit), file, line });
    }
  }

  if (casados < totalRoute) {
    idx.unresolved.push({
      kind: 'ktor-route-unparsed',
      file,
      line: 0,
      detail: `${totalRoute - casados} chamada(s) route() com argumento não-literal composto; as rotas sob elas não são emitidas`,
    });
    return;
  }
  idx.absolute.push(...tokens);
}

/**
 * Python: FastAPI (`@app.get("/x")`, `APIRouter(prefix="/api")`) e Flask
 * (`@app.route("/x", methods=["GET","POST"])`).
 *
 * O prefixo do `APIRouter` é resolvido quando declarado no mesmo arquivo — mesma regra do router
 * de Express. Decorator sobre símbolo sem prefixo conhecido não emite path parcial; vira
 * `router-prefix-unknown`, porque `/orders` e `/api/v1/orders` são endpoints diferentes e chutar
 * o primeiro é inventar.
 */
function indexPython(text, file, idx) {
  const prefixes = new Map();     // símbolo do router -> prefixo literal
  const semPrefixo = new Set();   // router declarado sem prefix=
  const routerRe = /(\w+)\s*=\s*APIRouter\s*\(([^)]*)\)/g;
  for (let m; (m = routerRe.exec(text)); ) {
    const pm = m[2].match(/prefix\s*=\s*(['"][^'"]*['"])/);
    if (!pm) { semPrefixo.add(m[1]); continue; }
    const lit = literal(pm[1]);
    if (lit === null) { semPrefixo.add(m[1]); continue; }
    prefixes.set(m[1], lit);
  }
  const apps = new Set();
  for (const m of text.matchAll(/(\w+)\s*=\s*(?:FastAPI|Flask)\s*\(/g)) apps.add(m[1]);

  const emit = (recv, verb, rel, at) => {
    const line = lineOf(text, at);
    if (apps.has(recv)) { idx.absolute.push({ method: verb, path: normalizePath(rel), file, line }); return; }
    if (prefixes.has(recv)) { idx.absolute.push({ method: verb, path: joinPath(prefixes.get(recv), rel), file, line }); return; }
    idx.unresolved.push({
      kind: 'router-prefix-unknown',
      file,
      line,
      detail: `@${recv}.${verb.toLowerCase()}('${rel}') — '${recv}' não é app conhecido nem APIRouter com prefix literal; o prefixo é desconhecido`,
    });
  };

  // FastAPI: @app.get("/x") / @router.post("/y")
  for (const verb of HTTP_VERBS) {
    const re = new RegExp(`@\\s*(\\w+)\\s*\\.\\s*${verb}\\s*\\(\\s*(['"][^'"]*['"])`, 'g');
    for (let m; (m = re.exec(text)); ) {
      const lit = literal(m[2]);
      if (lit === null) { idx.unresolved.push({ kind: 'route-path-not-literal', file, line: lineOf(text, m.index), detail: m[2].slice(0, 60) }); continue; }
      emit(m[1], verb.toUpperCase(), lit, m.index);
    }
  }
  // Flask: @app.route("/x", methods=["GET", "POST"]) — sem methods, o default do Flask é GET
  const flaskRe = /@\s*(\w+)\s*\.\s*route\s*\(\s*(['"][^'"]*['"])([^)]*)\)/g;
  for (let m; (m = flaskRe.exec(text)); ) {
    const lit = literal(m[2]);
    if (lit === null) { idx.unresolved.push({ kind: 'route-path-not-literal', file, line: lineOf(text, m.index), detail: m[2].slice(0, 60) }); continue; }
    const metodos = [...m[3].matchAll(/['"](GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)['"]/gi)].map((x) => x[1].toUpperCase());
    for (const verb of metodos.length ? [...new Set(metodos)] : ['GET']) emit(m[1], verb, lit, m.index);
  }
}

/**
 * Go: chi/gorilla (`r.Get("/x", h)`, `r.HandleFunc("/x", h).Methods("GET")`) e net/http
 * (`mux.HandleFunc("/x", h)`).
 *
 * `HandleFunc` de net/http não declara verbo — o handler decide por dentro. Emitir um verbo
 * escolhido pelo scanner seria inventar metade do endpoint, então vira `route-verb-unknown` com
 * o path registrado: o SUR-02 consegue avisar, e o SUR-01 não bloqueia sobre um palpite.
 */
function indexGo(text, file, idx) {
  const VERBOS_GO = ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Head', 'Options'];
  for (const verb of VERBOS_GO) {
    const re = new RegExp(`\\b\\w+\\s*\\.\\s*${verb}\\s*\\(\\s*("[^"]*"|\`[^\`]*\`)`, 'g');
    for (let m; (m = re.exec(text)); ) {
      const lit = literal(m[1]);
      if (lit === null) { idx.unresolved.push({ kind: 'route-path-not-literal', file, line: lineOf(text, m.index), detail: m[1].slice(0, 60) }); continue; }
      if (!lit.startsWith('/')) continue;
      idx.absolute.push({ method: verb.toUpperCase(), path: normalizePath(lit), file, line: lineOf(text, m.index) });
    }
  }
  const hfRe = /\b\w+\s*\.\s*HandleFunc\s*\(\s*("[^"]*"|`[^`]*`)\s*,[^)]*\)\s*(?:\.\s*Methods\s*\(([^)]*)\))?/g;
  for (let m; (m = hfRe.exec(text)); ) {
    const lit = literal(m[1]);
    if (lit === null) { idx.unresolved.push({ kind: 'route-path-not-literal', file, line: lineOf(text, m.index), detail: m[1].slice(0, 60) }); continue; }
    if (!lit.startsWith('/')) continue;
    const line = lineOf(text, m.index);
    const metodos = m[2] ? [...m[2].matchAll(/"(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)"/gi)].map((x) => x[1].toUpperCase()) : [];
    if (metodos.length) {
      for (const verb of [...new Set(metodos)]) idx.absolute.push({ method: verb, path: normalizePath(lit), file, line });
      continue;
    }
    idx.unresolved.push({
      kind: 'route-verb-unknown',
      file,
      line,
      detail: `HandleFunc("${lit}") sem .Methods(...) — o handler decide o verbo por dentro; o path existe mas o método é desconhecido`,
    });
  }
}

/**
 * Express/Fastify (`app.get('/x', h)`, `router.post(...)`) e Nest (`@Controller('x')` + `@Get('y')`).
 *
 * Router montado em prefixo (`app.use('/api/v2', router)`, `fastify.register(r, { prefix })`) é
 * resolvido quando a montagem está no mesmo arquivo. Router SEM montagem conhecida não emite
 * rota: `router.post('/orders')` sozinho vale `/orders` ou `/api/v2/orders` conforme o mount, e
 * chutar o primeiro é inventar path.
 */
function indexJsHttp(text, struct, file, idx) {
  // Map<símbolo, prefixo[]>: montar o MESMO router em dois prefixos é legítimo em Express e as
  // duas rotas existem em runtime. Guardar um prefixo só por símbolo (o último a aparecer) perdia
  // silenciosamente metade da superfície nesse arranjo.
  const mounts = new Map();
  const useRe = /\b(?:app|server|router)\s*\.\s*use\s*\(\s*(['"`][^'"`]*['"`])\s*,\s*(\w+)/g;
  for (let m; (m = useRe.exec(text)); ) {
    const lit = literal(m[1]);
    if (lit !== null) push(mounts, m[2], lit);
  }
  const regRe = /\b(?:fastify|app|server)\s*\.\s*register\s*\(\s*(\w+)\s*,\s*\{[^}]*prefix\s*:\s*(['"`][^'"`]*['"`])/g;
  for (let m; (m = regRe.exec(text)); ) {
    const lit = literal(m[2]);
    if (lit !== null) push(mounts, m[1], lit);
  }

  // Mount CROSS-ARQUIVO (LDG-0019): no layout canônico de Express o router mora num arquivo e o
  // `app.use()` que o monta mora no app.js. Enquanto `mounts` era só local, esse arranjo — um dos
  // mais comuns que existem — produzia exclusivamente `router-mount-unknown` e ZERO rotas.
  // Aqui a montagem vira fato do índice GLOBAL, resolvido na passa 2, na mesma simetria que os
  // produtores .NET já têm. Só entram símbolos que um import/require resolve para um arquivo: um
  // mount cujo alvo não se resolve continua desconhecido, nunca chutado.
  const imports = new Map(); // símbolo local -> especificador do módulo
  const reqRe = /(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*(['"`][^'"`]+['"`])\s*\)/g;
  for (let m; (m = reqRe.exec(text)); ) {
    const spec = literal(m[2]);
    if (spec !== null) imports.set(m[1], spec);
  }
  const impRe = /\bimport\s+(\w+)\s*(?:,\s*\{[^}]*\}\s*)?from\s*(['"`][^'"`]+['"`])/g;
  for (let m; (m = impRe.exec(text)); ) {
    const spec = literal(m[2]);
    if (spec !== null) imports.set(m[1], spec);
  }
  for (const [sym, prefixes] of mounts) {
    const spec = imports.get(sym);
    if (spec === undefined) continue;      // símbolo local: já resolvido pelo mount do próprio arquivo
    if (!spec.startsWith('.')) continue;   // pacote de terceiro não é router deste repositório
    for (const prefix of prefixes) idx.mounts.push({ from: file, spec, prefix });
  }

  const isRoot = (r) => /^(app|server|fastify)$/.test(r);
  // Router reconhecido pela ATRIBUIÇÃO, não só pelo nome: `const r = Router()` é tão router
  // quanto `const usersRouter = express.Router()`, e a heurística de nome sozinha descartava o
  // primeiro em silêncio — junto com todas as rotas dele. O nome continua valendo como sinal
  // adicional, para o caso de o router chegar por parâmetro de função.
  const declaredRouters = new Set();
  // cobre `express.Router()`, `Router()`, `new Router()` e `require('express').Router()` — esta
  // última é forma corrente e não casava, o que fazia o arquivo inteiro sumir sem diagnóstico.
  const routerDeclRe = /(?:const|let|var)\s+(\w+)\s*=\s*(?:new\s+)?(?:(?:require\s*\(\s*['"`][^'"`]+['"`]\s*\)|express|fastify)\s*\.\s*)?Router\s*\(/g;
  for (let m; (m = routerDeclRe.exec(text)); ) declaredRouters.add(m[1]);
  // Sinal de que ESTE arquivo fala o dialeto: só nele um receptor desconhecido em `x.get('/…')`
  // é candidato a rota. Sem essa âncora, todo `axios.get('/users')` do repositório viraria
  // irresolúvel — ruído que treina a pessoa a ignorar o relatório.
  const usaFramework = /require\s*\(\s*['"`](express|fastify|koa)['"`]|from\s*['"`](express|fastify|koa)['"`]/.test(text)
    || declaredRouters.size > 0;
  const isRouter = (r) => declaredRouters.has(r) || /^(router|api|routes)$/i.test(r) || /(Router|Routes)$/.test(r);

  for (const verb of HTTP_VERBS) {
    const re = new RegExp(`\\b(\\w+)\\s*\\.\\s*${verb}\\s*\\(\\s*([^,)]*)`, 'g');
    for (let m; (m = re.exec(text)); ) {
      const recv = m[1];
      if (!isRoot(recv) && !isRouter(recv) && !mounts.has(recv)) {
        // Não descartar em silêncio: num arquivo que usa o framework, um receptor que o scanner
        // não classifica pode ser um router batizado de forma que a heurística não prevê — e
        // "nenhuma rota, nenhum irresolúvel" deixa o cruzamento verde por vacuidade, que é
        // exatamente o que este módulo existe para impedir.
        const litOpaco = literal(m[2]);
        if (usaFramework && litOpaco !== null && litOpaco.startsWith('/')) {
          idx.unresolved.push({
            kind: 'route-receiver-unknown',
            file,
            line: lineOf(text, m.index),
            detail: `${recv}.${verb}('${litOpaco}') — '${recv}' não é app/router reconhecido nem tem mount conhecido; se for um router, o prefixo dele é desconhecido`,
          });
        }
        continue;
      }
      const line = lineOf(text, m.index);
      const lit = literal(m[2]);
      if (lit === null) {
        idx.unresolved.push({ kind: 'route-path-not-literal', file, line, detail: m[2].slice(0, 60) });
        continue;
      }
      if (!lit.startsWith('/')) continue;
      if (isRoot(recv)) {
        idx.absolute.push({ method: verb.toUpperCase(), path: normalizePath(lit), file, line });
        continue;
      }
      const mount = mounts.get(recv);
      if (mount === undefined || !mount.length) {
        // Sem mount LOCAL: a rota fica pendente do índice global de mounts, resolvida na passa 2.
        // Se ninguém montar este arquivo, a passa 2 a devolve como `router-mount-unknown` — o
        // veredito de antes, só que tomado depois de olhar o repositório inteiro em vez de um
        // arquivo isolado.
        idx.pendingRoutes.push({ method: verb.toUpperCase(), rel: lit, recv, file, line });
        continue;
      }
      for (const prefix of [...new Set(mount)]) {
        idx.absolute.push({ method: verb.toUpperCase(), path: joinPath(prefix, lit), file, line });
      }
    }
  }

  if (!/@Controller\s*\(/.test(text)) return;
  const classes = classesOf(struct);
  const prefixes = new Map();
  classes.forEach((c, i) => {
    const desde = i > 0 ? classes[i - 1].end : 0;
    const raw = attrBefore(text, desde, c.declIndex, /@Controller\s*\(\s*([^)]*?)\s*\)/g);
    if (raw === null) { prefixes.set(c.name, { path: '', ok: true }); return; }
    const lit = literal(raw);
    if (lit === null) {
      idx.unresolved.push({ kind: 'class-route-not-literal', file, line: lineOf(text, c.declIndex), detail: raw.slice(0, 60) });
      prefixes.set(c.name, { path: '', ok: false });
      return;
    }
    prefixes.set(c.name, { path: lit, ok: true });
  });

  for (const verb of HTTP_VERBS) {
    const cap = verb[0].toUpperCase() + verb.slice(1);
    const re = new RegExp(`@${cap}\\s*\\(\\s*([^)]*?)\\s*\\)`, 'g');
    for (let m; (m = re.exec(text)); ) {
      const line = lineOf(text, m.index);
      const owner = containerOf(classes, m.index);
      const pref = owner ? prefixes.get(owner.name) : null;
      const lit = m[1] === '' ? '' : literal(m[1]);
      if (m[1] !== '' && lit === null) {
        idx.unresolved.push({ kind: 'route-path-not-literal', file, line, detail: m[1].slice(0, 60) });
        continue;
      }
      if (!pref || !pref.ok) {
        idx.unresolved.push({ kind: 'route-prefix-unresolved', file, line, detail: `@${cap}() em classe sem @Controller literal — prefixo desconhecido` });
        continue;
      }
      idx.absolute.push({ method: verb.toUpperCase(), path: joinPath(pref.path, lit || ''), file, line });
    }
  }
}

// ── Passa 2: composição transitiva ─────────────────────────────────────────────────────────

// resolveSpec: especificador relativo de import/require → caminho de arquivo do índice, tentando
// as formas que Node aceita (extensão explícita, extensão implícita, index do diretório). Devolve
// null quando nada casa — mount para arquivo que o scanner não leu não é mount conhecido.
function resolveSpec(fromFile, spec, knownFiles) {
  const base = posixDirname(fromFile);
  const target = posixJoin(base, spec);
  const cands = [target];
  for (const ext of ['.js', '.mjs', '.cjs', '.ts']) cands.push(target + ext);
  for (const ext of ['.js', '.mjs', '.cjs', '.ts']) cands.push(posixJoin(target, 'index' + ext));
  for (const c of cands) if (knownFiles.has(c)) return c;
  return null;
}
function posixDirname(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
function posixJoin(a, b) {
  const parts = [];
  for (const seg of `${a}/${b}`.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  return parts.join('/');
}

// candidatasVisiveis: das N definições homônimas de um produtor, quais o arquivo que INVOCA
// enxerga de fato — `using` do chamador, seu próprio namespace, e os `global using` do projeto.
// Produtor sem namespace está no namespace global e é visível de qualquer lugar.
// Devolve a lista original quando o filtro não ajuda (nenhuma candidata visível): nesse caso o
// scanner não sabe menos do que sabia, e continua reportando ambiguidade em vez de escolher.
function candidatasVisiveis(cands, callFile, idx) {
  if (cands.length <= 1) return cands;
  const escopo = idx.csScope.get(callFile);
  if (!escopo) return cands;
  const visivel = new Set([...escopo.usings, ...idx.csGlobalUsings]);
  if (escopo.ns) visivel.add(escopo.ns);
  const filtradas = cands.filter((p) => !p.ns || visivel.has(p.ns));
  return filtradas.length ? filtradas : cands;
}

function compose(idx) {
  const routes = [];
  const unresolved = [...idx.unresolved];

  // ── mounts cross-arquivo (LDG-0019) ──────────────────────────────────────────────────────
  // Cada `app.use('/prefix', importado)` vira um prefixo aplicável ao ARQUIVO que o import
  // resolve. Um mesmo arquivo montado em dois prefixos é UNIÃO, não ambiguidade: em Express as
  // duas montagens existem em runtime e as duas rotas respondem — o oposto do produtor .NET
  // homônimo, em que N definições disputam UMA invocação e escolher seria inventar.
  const knownFiles = new Set(idx.files || []);
  const prefixesByFile = new Map();
  for (const m of idx.mounts || []) {
    const target = resolveSpec(m.from, m.spec, knownFiles);
    if (target === null) {
      unresolved.push({
        kind: 'router-mount-unresolved-import',
        file: m.from,
        line: 0,
        detail: `app.use('${m.prefix}', …) monta '${m.spec}', que não resolve para nenhum arquivo lido — o prefixo existe mas não se sabe a que rotas aplicar`,
      });
      continue;
    }
    push(prefixesByFile, target, m.prefix);
  }
  for (const p of idx.pendingRoutes || []) {
    const prefixes = prefixesByFile.get(p.file);
    if (!prefixes || !prefixes.length) {
      unresolved.push({
        kind: 'router-mount-unknown',
        file: p.file,
        line: p.line,
        detail: `${p.recv}.${p.method.toLowerCase()}('${p.rel}') — nenhum app.use()/register() conhecido monta '${p.recv}', neste arquivo nem em outro; o prefixo é desconhecido`,
      });
      continue;
    }
    for (const prefix of [...new Set(prefixes)]) {
      routes.push({ method: p.method, path: normalizePath(joinPath(prefix, p.rel)), file: p.file, line: p.line, chain: [] });
    }
  }

  // Rotas já absolutas (atributos, Spring, Ktor, Express) entram direto — nesses dialetos o
  // prefixo é léxico e já foi resolvido na indexação.
  for (const a of idx.absolute) {
    routes.push({ method: a.method, path: normalizePath(a.path), file: a.file, line: a.line, chain: a.chain || [] });
  }

  const routesByOwner = new Map();
  for (const r of idx.routes) push(routesByOwner, r.owner, r);
  const callsByOwner = new Map();
  for (const c of idx.calls) push(callsByOwner, c.owner, c);

  const groupById = new Map();
  for (const g of idx.groups) groupById.set(g.id, g);
  const groupsByParent = new Map();
  for (const g of idx.groups) push(groupsByParent, g.parent, g);

  const allProducers = [...idx.producers.values()].flat();
  const producerByOwner = new Map();
  for (const p of allProducers) producerByOwner.set(`${p.scope}:${p.param}`, p);

  // A ambiguidade é julgada POR CHAMADA, não por nome: o mesmo `MapEndpoints` pode ser inequívoco
  // num host que importa uma feature só e ambíguo noutro que importa várias. Julgar pelo nome
  // global condenava o primeiro caso junto com o segundo.
  const invokedNames = new Set();
  const ambiguousNames = new Set();
  for (const c of idx.calls) {
    const cands = candidatasVisiveis(idx.producers.get(c.producer) || [], c.file, idx);
    if (cands.length === 1) invokedNames.add(c.producer);
    else if (cands.length > 1) ambiguousNames.add(c.producer);
  }

  // Um owner é RAIZ quando o prefixo dele é conhecido sem se saber quem o invocou: o `app` do
  // top-level, ou o parâmetro de um produtor que recebe a raiz da aplicação e não é invocado por
  // ninguém. O parâmetro de um produtor RELATIVO nunca é raiz — o path das rotas dele só existe
  // depois de composto com o prefixo do chamador.
  const producerByScope = new Map();
  for (const p of allProducers) producerByScope.set(p.scope, p);

  const isRootOwner = (ownerId) => {
    if (groupById.has(ownerId)) return false;
    const p = producerByOwner.get(ownerId);
    // Produtor ambíguo não é raiz: promovê-lo emitia as rotas dele CRUAS, sem o prefixo de quem o
    // invoca, bem ao lado do `producer-ambiguous` que diz não saber qual prefixo é. As duas
    // correções se anulavam.
    if (p) return p.rootLike && !invokedNames.has(p.name) && !ambiguousNames.has(p.name);
    // Owner desconhecido: só é raiz no escopo de topo do arquivo. Dentro do corpo de um produtor
    // RELATIVO, um receptor que não é o parâmetro nasceu de `group.RequireAuthorization()` ou
    // `group.WithTags()` — idioma corrente de ASP.NET — e o prefixo dele é o do chamador.
    const escopo = ownerId.slice(0, ownerId.lastIndexOf(':'));
    const dono = producerByScope.get(escopo);
    if (dono && !dono.rootLike) return false;
    return true;
  };

  const MAX_DEPTH = 12;
  const reachedGroups = new Set();
  const visitedOwners = new Set();
  const profundoReportado = new Set();

  function walk(ownerId, prefix, chain, depth, stack, originFile) {
    if (depth > MAX_DEPTH) {
      if (!profundoReportado.has(ownerId)) {
        profundoReportado.add(ownerId);
        unresolved.push({ kind: 'chain-too-deep', file: originFile, line: 0, detail: `cadeia excedeu ${MAX_DEPTH} saltos a partir de '${prefix}'` });
      }
      return;
    }
    // Sem este corte um ciclo de produtores custa b^MAX_DEPTH: cinco registradores que se
    // invocam mutuamente chegavam a alguns GB de RSS antes de terminar.
    if (stack.has(ownerId)) {
      unresolved.push({ kind: 'chain-cycle', file: originFile, line: 0, detail: `ciclo de produtores alcançando '${prefix}' — composição interrompida` });
      return;
    }
    const next = new Set(stack);
    next.add(ownerId);
    visitedOwners.add(ownerId);

    for (const r of routesByOwner.get(ownerId) || []) {
      routes.push({ method: r.method, path: joinPath(prefix, r.path), file: r.file, line: r.line, chain: [...chain] });
    }

    for (const g of groupsByParent.get(ownerId) || []) {
      reachedGroups.add(g.id);
      // Prefixo irresolúvel já foi reportado na indexação; descer aqui emitiria path parcial.
      if (g.path === null) continue;
      walk(g.id, joinPath(prefix, g.path), [...chain, `MapGroup(${g.path})`], depth + 1, next, g.file);
    }

    for (const c of callsByOwner.get(ownerId) || []) {
      const cands = candidatasVisiveis(idx.producers.get(c.producer) || [], c.file, idx);
      if (cands.length === 0) {
        unresolved.push({
          kind: 'producer-not-found',
          file: c.file,
          line: c.line,
          detail: `${c.producer}() — nenhuma definição encontrada; o prefixo '${prefix}' fica sem sufixo conhecido`,
        });
        continue;
      }
      if (cands.length > 1) {
        unresolved.push({
          kind: 'producer-ambiguous',
          file: c.file,
          line: c.line,
          detail: `${c.producer}() tem ${cands.length} definições homônimas (${cands.map((p) => p.file).join(', ')}) e o scanner não sabe qual delas '${prefix}' invoca`,
        });
        continue;
      }
      const p = cands[0];
      walk(`${p.scope}:${p.param}`, prefix, [...chain, c.producer], depth + 1, next, p.file);
    }
  }

  const rootOwners = new Map();
  const noteRoot = (ownerId, file) => {
    if (!isRootOwner(ownerId)) return;
    if (!rootOwners.has(ownerId)) rootOwners.set(ownerId, file);
  };
  for (const g of idx.groups) noteRoot(g.parent, g.file);
  for (const c of idx.calls) noteRoot(c.owner, c.file);
  for (const r of idx.routes) noteRoot(r.owner, r.file);

  for (const [ownerId, file] of rootOwners) walk(ownerId, '', [], 0, new Set(), file);

  // Produtor RELATIVO que registra rotas e nunca é invocado: as rotas existem no código e não
  // estão penduradas em prefixo conhecido. Reportado, nunca descartado — é o caso em que o
  // cruzamento passaria por vacuidade.
  for (const p of allProducers) {
    if (invokedNames.has(p.name) || ambiguousNames.has(p.name)) continue;
    if (p.rootLike) continue;
    const ownerId = `${p.scope}:${p.param}`;
    const registra = (routesByOwner.get(ownerId) || []).length > 0
      || (groupsByParent.get(ownerId) || []).length > 0
      || (callsByOwner.get(ownerId) || []).length > 0;
    if (!registra) continue;
    unresolved.push({
      kind: 'producer-never-invoked',
      file: p.file,
      line: p.line,
      detail: `${p.name}() registra rotas e não é invocado por grupo nenhum — prefixo desconhecido`,
    });
  }

  for (const [owner, list] of routesByOwner) {
    if (visitedOwners.has(owner) || groupById.has(owner) || producerByOwner.has(owner)) continue;
    unresolved.push({
      kind: 'receiver-unknown',
      file: list[0].file,
      line: list[0].line,
      detail: `'${owner.slice(owner.lastIndexOf(':') + 1)}' registra ${list.length} rota(s) e não é grupo, parâmetro de produtor nem raiz — prefixo desconhecido`,
    });
  }

  // Grupo que ficou fora da travessia porque um ancestral tem prefixo irresolúvel.
  for (const g of idx.groups) {
    if (reachedGroups.has(g.id) || g.path === null) continue;
    if ((routesByOwner.get(g.id) || []).length === 0 && (groupsByParent.get(g.id) || []).length === 0) continue;
    // Produtor não alcançado já tem diagnóstico próprio; não duplica.
    if (producerByOwner.has(g.parent)) continue;
    unresolved.push({
      kind: 'group-unreachable',
      file: g.file,
      line: g.line,
      detail: `grupo '${g.path}' pende de '${g.parent.slice(g.parent.lastIndexOf(':') + 1)}', que o scanner não resolveu; as rotas dele não são emitidas`,
    });
  }

  return { routes, unresolved };
}

// ── API pública ────────────────────────────────────────────────────────────────────────────

/**
 * Varre os caminhos informados e devolve as rotas HTTP que o código expõe.
 *
 * @returns {{routes: Array, unresolved: Array}} `routes` com `{method, path, file, line, chain}`
 *          já normalizados e deduplicados; `unresolved` com tudo que o scanner viu e não
 *          conseguiu resolver — nunca vazio por omissão.
 */
export function scanRoutes(paths, { exts = ROUTE_EXTS, skipDirs = DEFAULT_SKIP, root = process.cwd() } = {}) {
  const files = [...new Set(collect(paths, { exts, skipDirs }))];
  const idx = { groups: [], producers: new Map(), routes: [], calls: [], absolute: [], unresolved: [], mounts: [], pendingRoutes: [], files: [], csScope: new Map(), csGlobalUsings: new Set() };

  for (const f of files) {
    const raw = readFileSync(f, 'utf8');
    const { code: text, struct } = project(raw);
    const rel = relative(root, f) || f;
    idx.files.push(rel);   // índice de arquivos lidos: resolveSpec() casa mounts contra ele
    const ext = f.slice(f.lastIndexOf('.'));

    if (ext === '.cs') {
      indexDotnetMinimal(text, struct, rel, idx);
      indexDotnetAttributes(text, struct, rel, idx);
    } else if (ext === '.java') {
      indexSpring(text, struct, rel, idx);
    } else if (ext === '.kt') {
      indexKtor(text, struct, rel, idx);
      indexSpring(text, struct, rel, idx);
    } else if (ext === '.ts' || ext === '.js' || ext === '.mjs') {
      indexJsHttp(text, struct, rel, idx);
    } else if (ext === '.py') {
      indexPython(text, rel, idx);
    } else if (ext === '.go') {
      indexGo(text, rel, idx);
    }
  }

  for (const p of paths) {
    if (!existsSync(p)) {
      idx.unresolved.push({ kind: 'source-missing', file: relative(root, p) || p, line: 0, detail: 'caminho de código declarado e inexistente — nenhuma rota é lida dali, e ausência de rota deixa o cruzamento verde por vacuidade' });
    } else if (collect([p], { exts, skipDirs }).length === 0) {
      idx.unresolved.push({ kind: 'source-empty', file: relative(root, p) || p, line: 0, detail: `caminho declarado e sem nenhum arquivo de dialeto suportado — nada foi lido, e nada lido não é o mesmo que nada exposto` });
    }
  }

  const { routes, unresolved } = compose(idx);

  const seen = new Set();
  const deduped = [];
  for (const r of routes) {
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }
  deduped.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));

  return { routes: deduped, unresolved };
}

/** Conjunto `MÉTODO path` das rotas, para cruzamento com o contrato. */
export function routeKeys(routes) {
  return new Set(routes.map((r) => `${r.method} ${r.path}`));
}
