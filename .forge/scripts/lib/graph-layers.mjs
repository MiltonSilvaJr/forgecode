// lib/graph-layers.mjs — taxonomia de camada do code graph (issue #38). Biblioteca pura,
// zero-dep, SEM entrada CLI própria; consumida por graph-build.mjs (classificação + métrica)
// e por validate-graph.mjs (classificação de órfãos).
//
// Quatro responsabilidades, na ordem em que a issue as coloca (a quarta é do LDG-0027):
//
// 1. MAPA DE CAMADAS DECLARÁVEL. A heurística embutida (`builtinLayerOf`) nasceu ancorada na
//    convenção `services/<x>/src/<X>.{Domain,Application,…}` e todo código .NET fora dessa
//    forma cai em `unknown` — no repositório medido na issue, 403 arquivos C# em três layouts
//    distintos (plataforma satélite, `packages/dotnet/…`, monólito legado pré-Clean-
//    Architecture). Em vez de continuar empilhando regex no engine a cada layout novo, o
//    repositório DECLARA os seus: bloco `codegraph.layers` no frontmatter do `.forge/FORGE.md`,
//    cada item um par `path` (glob) → `layer`. O declarado vence a heurística; a heurística
//    embutida continua sendo o default de quem não declarou nada.
//
//    Por que o frontmatter do FORGE.md e não o forge.yaml: é a mesma natureza (e o mesmo
//    parser, e o mesmo arquivo) de `authz.pep_paths`/`observability.wrapper_paths`, blocos de
//    globs sobre a topologia do próprio repositório que o graph-build já lê hoje. O
//    `forge.yaml` é o manifesto de INSTALAÇÃO do harness (adapters, diretórios, flags) e o
//    graph-build nem o abre — declarar arquitetura ali separaria a descrição do repositório em
//    dois arquivos com dois leitores.
//
// 2. `unknown` COMO ESTADO LEGÍTIMO. `unknown` significa hoje duas coisas incompatíveis: "a
//    heurística não soube" (lacuna real) e "a taxonomia domain/application/infrastructure/api/
//    contracts não descreve isto" (frontend, tooling, MDX de doc, spec de E2E). Declarar
//    `layer: unknown` para um path é a segunda afirmação, explicitamente: o node ganha
//    `taxonomy: "out"` e sai do DENOMINADOR da cobertura de camada. `unknown` NÃO declarado
//    continua contando como lacuna — senão a métrica vira 100% por construção e deixa de medir.
//
// 3. ÓRFÃO POR DESIGN ≠ CÓDIGO MORTO. Marcador de assembly resolvido por reflexão, migration
//    descoberta por varredura de assembly, spec de E2E de browser e conteúdo estático são
//    órfãos CORRETOS. No repositório medido, dos 926 órfãos apenas 4 eram código morto — o
//    warning de "926 órfãos" não ajudava a chegar a esses 4. `classifyOrphans` separa os dois.
//
// 4. RAIZ DE VARREDURA DECLARÁVEL (LDG-0027). `graph-build.mjs` pula diretório de nome oculto
//    (prefixo `.`) e uma lista fixa de nomes de saída de build (SKIP_DIRS) — correto por
//    default: em projeto CONSUMIDOR, `.forge/` é o harness instalado, não o produto. Mas o
//    repositório que PRODUZ o harness tem seu produto sob um diretório assim (`template/.forge/
//    scripts/**`), e ficava invisível para /forge:codegraph, /forge:onboard, /forge:c4 e
//    /forge:impact rodando sobre si mesmo. Em vez de uma exceção com o nome do projeto embutida
//    no motor, o repositório DECLARA: `codegraph.include_paths` no frontmatter do FORGE.md —
//    mesmo bloco, mesmo dialeto de glob de `codegraph.layers` — lista caminhos que são
//    código-fonte mesmo quando o nome bateria com o default de "pular". Bloco ausente = nenhum
//    caminho forçado = o walk de hoje, byte a byte (compatibilidade — gate w141).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseYamlSubset } from './yaml-lite.mjs';

export const LAYER_VALUES = ['api', 'application', 'domain', 'infrastructure', 'contracts', 'test', 'config', 'unknown'];

// ── glob → RegExp ────────────────────────────────────────────────────────────────────────
// Mesmo dialeto de pep_paths/wrapper_paths (`*` casa dentro de UM segmento; o padrão casa o
// próprio path e tudo abaixo dele), MAIS `**` como segmento inteiro, que atravessa zero ou
// mais segmentos. O `**` existe porque os layouts reais têm profundidade variável
// (`platform/**/*.Kernel` cobre `src/shared/` e `src/services/<svc>/` sem duas declarações).
// Deliberadamente NÃO se mexeu no globToRegExp de graph-build/graph-govern: mudar o dialeto
// de `pep_paths` de carona alteraria a semântica de um gate de autorização já em produção.
export function layerGlobToRegExp(glob) {
  const raw = String(glob || '').trim().replace(/^\.?\//, '').replace(/\/+$/, '');
  if (!raw) return null;
  const all = raw.split('/');
  const segs = all.filter((s, i) => !(s === '**' && i === all.length - 1));
  if (!segs.length) return null;
  let out = '^';
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg === '**') { out += '(?:[^/]+/)*'; continue; }
    out += seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    if (i < segs.length - 1) out += '/';
  }
  return new RegExp(`${out}(?:/.*)?$`);
}

// ── heurística embutida (default de quem não declara nada) ───────────────────────────────
// MOVIDA sem uma vírgula de alteração de graph-build.mjs: é o comportamento de hoje e o
// cenário de compatibilidade do gate w141 compara o grafo contra um golden capturado com o
// engine pré-mudança, justamente para que essa mudança de arquivo não vire mudança de
// veredito. Dois sinais: convenções de pasta (controllers/, domain/…) E o sufixo de projeto
// .NET (Collatra.Billing.Domain/… → domain), que a heurística só-de-pasta perdia em ~55% dos
// arquivos C# de soluções reais (G3).
export function builtinLayerOf(id) {
  const p = String(id).toLowerCase();
  if (/(^|\/)(tests?|__tests__|spec)(\/|$)|\.(spec|test|tests)\.|\.tests?(\/|$)/.test(p)) return 'test';
  // .NET project-suffix é AUTORITATIVO: o projeto inteiro é uma camada, independentemente dos
  // nomes de pasta internos (Collatra.X.Infrastructure/Services/ é infrastructure, não application).
  if (/\.(api|web|host|gateway|bff|presentation)(\/|$)/.test(p)) return 'api';
  if (/\.(application|usecases?|worker)(\/|$)/.test(p)) return 'application';
  if (/\.(domain|core)(\/|$)/.test(p)) return 'domain';
  if (/\.(infrastructure|infra|persistence|messaging|caching|observability|errorhandling)(\/|$)/.test(p)) return 'infrastructure';
  if (/\.(contracts?|dtos?)(\/|$)/.test(p)) return 'contracts';
  // convenções de pasta (não-.NET, ou projetos sem sufixo de camada). Os conjuntos de
  // presentation/api e infrastructure também carregam idiomas Android/mobile (ui/, viewmodel/,
  // screens/, activities e fragments como presentation; network/, datasource/, remote/,
  // retrofit/ como infrastructure) — o perfil brownfield dominante que a Understanding Layer
  // (§16) mira (issue #18). Palavras genéricas que colidem com domínios não-Android legítimos
  // ficam de fora de propósito: `compose` (Docker Compose), `room`/`dao`, `local`.
  if (/(^|\/)(api|controllers?|presentation|web|pages|routes|endpoints?|middlewares?|filters|attributes|ui|views?|viewmodels?|screens?|activity|activities|fragments?|widgets?)(\/|$)/.test(p)) return 'api';
  if (/(^|\/)(application|usecases?|interactors?|handlers?|services?|commands?|queries|behaviors?)(\/|$)/.test(p)) return 'application';
  if (/(^|\/)(domain|entities|core|model|models|aggregates?|valueobjects?|events?)(\/|$)/.test(p)) return 'domain';
  if (/(^|\/)(infrastructure|persistence|repositories|repository|data|datasources?|adapters?|migrations?|network|remote|retrofit)(\/|$)/.test(p)) return 'infrastructure';
  if (/(^|\/)(contracts?|dtos?|schemas?)(\/|$)/.test(p)) return 'contracts';
  if (/\.(config|json|ya?ml)$|(^|\/)config(\/|$)/.test(p)) return 'config';
  return 'unknown';
}

// ── frontmatter do FORGE.md ──────────────────────────────────────────────────────────────
// Ausência do arquivo, ausência de frontmatter ou frontmatter malformado ⇒ {} — no-op, jamais
// um falso positivo (mesma postura de readGovernanceBlocks).
export function readForgeFrontmatter(repoRoot) {
  const p = join(repoRoot, '.forge', 'FORGE.md');
  if (!existsSync(p)) return {};
  try {
    const m = readFileSync(p, 'utf8').match(/^---\n([\s\S]*?)\n---/);
    if (!m) return {};
    const fm = parseYamlSubset(m[1]);
    return (fm && typeof fm === 'object' && !Array.isArray(fm)) ? fm : {};
  } catch { return {}; }
}

// ── bloco codegraph: → mapa compilado ────────────────────────────────────────────────────
// Toda forma inesperada é ignorada item a item (lista que veio escalar, item sem path, layer
// fora do enum): configuração malformada degrada para a heurística embutida, nunca derruba o
// build nem inventa camada.
export function compileLayerMap(frontmatter) {
  const block = (frontmatter && typeof frontmatter.codegraph === 'object' && !Array.isArray(frontmatter.codegraph))
    ? frontmatter.codegraph : {};
  const rules = [];
  const declared = Array.isArray(block.layers) ? block.layers : [];
  for (const item of declared) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const layer = String(item.layer || '').trim();
    if (!LAYER_VALUES.includes(layer)) continue;
    const re = layerGlobToRegExp(item.path);
    if (!re) continue;
    rules.push({ re, layer, path: String(item.path) });
  }
  const orphanGlobs = (Array.isArray(block.orphans_by_design) ? block.orphans_by_design : [])
    .map((g) => layerGlobToRegExp(g)).filter(Boolean);
  // include_paths (LDG-0027): mesmo dialeto de glob, mesma degradação item a item.
  const includeGlobs = (Array.isArray(block.include_paths) ? block.include_paths : [])
    .map((g) => layerGlobToRegExp(g)).filter(Boolean);
  return { rules, orphanGlobs, includeGlobs };
}

export function readLayerMap(repoRoot) {
  return compileLayerMap(readForgeFrontmatter(repoRoot));
}

// ── resolução de camada ──────────────────────────────────────────────────────────────────
// PRIMEIRO match declarado vence (ordem da declaração é o desempate, e é do autor da
// configuração — não de uma regra de especificidade que ele teria de adivinhar). Sem match
// declarado, cai na heurística embutida. `declared` distingue "unknown porque o repositório
// disse que este path está fora da taxonomia" de "unknown porque ninguém soube".
export function resolveLayer(id, map) {
  const rules = (map && map.rules) || [];
  for (const r of rules) {
    if (r.re.test(id)) return { layer: r.layer, declared: true };
  }
  return { layer: builtinLayerOf(id), declared: false };
}

// ── cobertura de camada ──────────────────────────────────────────────────────────────────
// O denominador é a população EM ESCOPO da taxonomia: classificados + lacunas. O que o
// repositório declarou fora da taxonomia sai do denominador — é a correção da leitura de que
// 18% do grafo era buraco quando não havia buraco. `ratio` é null (não 1) quando o denominador
// é zero: um grafo sem nenhum nó em escopo não tem cobertura 100%, tem cobertura indefinida.
export function layerCoverage(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  let classified = 0, unclassified = 0, outOfTaxonomy = 0;
  for (const n of list) {
    if (n && n.taxonomy === 'out') { outOfTaxonomy++; continue; }
    if (n && n.layer === 'unknown') unclassified++;
    else classified++;
  }
  const denominator = classified + unclassified;
  return {
    classified,
    unclassified,
    out_of_taxonomy: outOfTaxonomy,
    denominator,
    ratio: denominator ? Math.round((classified / denominator) * 10000) / 10000 : null,
  };
}

// ── classificação de órfãos ──────────────────────────────────────────────────────────────
// Órfão POR DESIGN, em ordem de decisão:
//   declared        — glob de `codegraph.orphans_by_design` (marcador de assembly resolvido
//                     por reflexão, plugin carregado por DI, o que o repositório souber nomear)
//   out-of-taxonomy — o repositório declarou o path fora da taxonomia (frontend, tooling,
//                     conteúdo estático): não importar código de produção é o estado correto
//   test            — spec de E2E de browser não importa produção; é o que se espera dela
//   config          — arquivo de configuração não participa do grafo de imports
//   migration       — migration é descoberta por varredura de assembly/diretório, nunca
//                     importada; embutido porque a convenção `migrations/` é universal
// O que sobra é CANDIDATO: código morto de verdade ou resolução de import incompleta. São os
// poucos que importam, e é para eles que o warning aponta.
export function classifyOrphans(orphanIds, nodesById, orphanGlobs) {
  const globs = Array.isArray(orphanGlobs) ? orphanGlobs : [];
  const byDesign = [];
  const candidates = [];
  for (const id of orphanIds) {
    const n = (nodesById && nodesById.get) ? nodesById.get(id) : null;
    let reason = null;
    if (globs.some((re) => re.test(id))) reason = 'declared';
    else if (n && n.taxonomy === 'out') reason = 'out-of-taxonomy';
    else if (n && n.layer === 'test') reason = 'test';
    else if (n && n.layer === 'config') reason = 'config';
    else if (/(^|\/)migrations?(\/|$)/i.test(id)) reason = 'migration';
    if (reason) byDesign.push({ id, reason });
    else candidates.push(id);
  }
  const reasons = {};
  for (const d of byDesign) reasons[d.reason] = (reasons[d.reason] || 0) + 1;
  return { byDesign, candidates, reasons };
}
