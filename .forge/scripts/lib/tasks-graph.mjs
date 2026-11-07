// lib/tasks-graph.mjs — grafo de tasks e cobertura de superfície, como CÓDIGO. Zero-dependência.
//
// POR QUE ESTE ARQUIVO EXISTE
//
// O harness já especificava os dois checks que este módulo implementa, e ambos eram instrução
// para um modelo:
//
//   - `commands/specs/tasks.md` §2 ("Auto-checagem") manda verificar que "nenhuma dependência
//     aponta para TASK inexistente ou posterior (ordem topológica válida)". Era um checklist em
//     markdown, e deixou passar, num plano de 89 tasks, uma dependência de Wave 4 para Wave 7.
//   - `commands/specs/analyze.md` item 6 manda cruzar o "Checklist de cobertura de superfície" do
//     requirements.md contra design e tasks, dizendo textualmente que é isso "que impede a lacuna
//     clássica de parâmetro implementado sem superfície de acesso descoberta só depois do marco".
//     Não existe script `analyze` — é comando `.md`, executado por um modelo.
//
// A diferença entre uma norma escrita e uma norma verificada é que a segunda roda sempre. Um
// modelo que confere 89 linhas de dependência acerta quase sempre, e "quase sempre" é o mesmo que
// "não" para um invariante estrutural.
//
// TRÊS DECISÕES QUE IMPORTAM
//
// 1. O parser não inventa precisão que não tem. `paths:` carrega brace-expansion de shell,
//    diretórios e listas — expandimos o que é expansível (`{a,b}`) e deixamos o resto literal
//    (um glob `**/*.ts` continua sendo a string, não uma lista de arquivos). Fingir resolução de
//    glob aqui produziria falso negativo silencioso, que é a pior falha possível num gate.
//
// 2. TSK-03 compara WAVES, não números de task. Dependência para um número maior dentro da mesma
//    wave é legítima (a wave é a unidade de paralelismo, e a ordem dentro dela é o próprio grafo);
//    dependência para wave posterior é impossível de satisfazer sem reordenar o plano.
//
// 3. SRF-01 dá veredito POR REQ, nunca por task. Uma task pode entregar um endpoint declarando
//    `paths:` apenas no projeto de domínio, com a rota nascendo noutro assembly — aconteceu no
//    repositório que motivou este módulo. Exigir que a task certa se declare produziria falso
//    positivo em cascata; exigir que ALGUMA das tasks que cobrem o REQ produza superfície pega o
//    defeito real (nenhuma das quatro produz) e sobrevive ao caso da declaração incompleta.

// ── normalização de ID ───────────────────────────────────────────────────────────────────────
// `TASK-7` e `TASK-07` são o mesmo nó. Normalizamos na entrada para que a comparação de arestas
// não dependa de zero-padding — mistura de larguras num mesmo arquivo é comum e inofensiva.
function normId(n) { return `TASK-${String(n).padStart(2, '0')}`; }

// ── expansão de braces ───────────────────────────────────────────────────────────────────────
// `src/{Api,Core}/Item.cs` → ['src/Api/Item.cs', 'src/Core/Item.cs']. Recursiva, para o caso de
// mais de um grupo na mesma string. String sem `{...}` volta intacta.
// O teto de 256 não é paranoia: cada grupo multiplica, e `push(...array)` com dezenas de milhares
// de itens estoura a pilha — o processo morreria sem imprimir linha de veredito, quebrando o
// contrato de saída do validador. Estourado o teto, devolvemos a string literal: menos precisão,
// nunca silêncio.
const MAX_EXPANSION = 256;
export function expandBraces(s) {
  const open = s.indexOf('{');
  if (open === -1) return [s];
  let depth = 0, close = -1;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) { close = i; break; } }
  }
  if (close === -1) return [s];                       // brace não fechada: literal, sem adivinhar
  const alts = splitTopLevel(s.slice(open + 1, close), ',');
  if (alts.length < 2) return [s];                    // `{x}` não é alternativa — deixa literal
  const out = [];
  for (const a of alts) {
    for (const e of expandBraces(s.slice(0, open) + a + s.slice(close + 1))) {
      if (out.length >= MAX_EXPANSION) return [s];
      out.push(e);
    }
  }
  return out;
}

// Split respeitando profundidade de `{}` — é o que impede a vírgula DENTRO das chaves de separar
// paths, e a vírgula de fora de ser engolida pela expansão.
function splitTopLevel(s, sep) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter((x) => x.length > 0);
}

// Cabeçalho de wave: qualquer nível de heading, com ou sem negrito, `—`/`-`/`:` como separador.
// Aceitar só `## Wave N` era falso negativo silencioso — com o cabeçalho em h1, TODA task ficava
// sem wave e a checagem de ordem topológica passava por vacuidade.
const WAVE_RE = /^#{1,6}\s*\**\s*(?:Wave|Onda)\s*\**\s+([0-9]+)\b\**\s*(.*)$/i;
// `- [ ] TASK-07 — título …`. Bullet `-` ou `*` (ambos válidos em markdown), espaçamento livre em
// torno do bullet, do checkbox e do ID; os quatro estados do tracker (` `, `-`, `X`, `!`).
const TASK_RE = /^\s*[-*]\s*\[([ xX\-!])\]\s*TASK-0*([0-9]+)\b\s*(.*)$/;

const META_KEYS = {
  rastreia: 'traces', traces: 'traces', trace: 'traces',
  paths: 'paths', path: 'paths',
  depende: 'dependsOn', 'depende de': 'dependsOn', depends: 'dependsOn',
  dependencias: 'dependsOn', 'dependências': 'dependsOn', 'dependencia': 'dependsOn', 'dependência': 'dependsOn',
  expoe: 'exposes', 'expõe': 'exposes', exposes: 'exposes',
};
// Varredura por NOME DE CAMPO, em qualquer ordem, com ou sem parênteses em volta.
//
// A primeira versão casava o bloco inteiro por forma — exigia abrir com `(rastreia:` e fechar com
// `)` no fim da linha. Seis maneiras de escrever a MESMA linha (ordem dos campos trocada, `rastreia`
// ausente, um espaço depois do parêntese, um comentário HTML depois do fecha-parêntese, a chave
// acentuada, o bullet com asterisco) faziam `dependsOn` nascer vazio. E um grafo sem arestas é um
// grafo sem defeitos: TSK-01, TSK-02 e TSK-03 desligavam em silêncio, que é a falha que este módulo
// existe para eliminar. Reconhecer o campo pelo NOME, onde ele estiver, remove a classe inteira.
const FIELD_RE = /(rastreia|traces?|trace|paths?|depende(?:\s+de)?|depends|depend[êe]ncias?|exp[õo]e|exposes)\s*:/gi;

function stripTicks(s) { return s.replace(/`/g, '').trim(); }
// `(rastreia: …)` → `rastreia: …`; também apara comentário HTML e pontuação decorativa no fim.
function trimWrappers(s) {
  return s.replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s(·—–:-]+/, '').replace(/[\s)]+$/, '');
}

// parseTasks(text) → { tasks, waves }. Task: { id, n, status, wave, title, traces, paths,
// dependsOn, exposes, line }. `wave` é null para task antes do primeiro cabeçalho de wave.
export function parseTasks(text) {
  const lines = String(text || '').split('\n');
  const tasks = [];
  const waves = [];
  let wave = null;
  lines.forEach((raw, i) => {
    const w = WAVE_RE.exec(raw);
    if (w) { wave = Number(w[1]); waves.push({ n: wave, title: w[2].replace(/^[\s—–-]+/, '').trim(), line: i + 1 }); return; }
    const m = TASK_RE.exec(raw);
    if (!m) return;
    const status = m[1] === 'x' ? 'X' : m[1];
    const n = Number(m[2]);
    const rest = m[3];
    const meta = { traces: [], paths: [], dependsOn: [], exposes: [] };

    // localiza cada campo pelo nome e recorta o valor até o próximo campo (ou o fim da linha)
    FIELD_RE.lastIndex = 0;
    const hits = [];
    let fm;
    while ((fm = FIELD_RE.exec(rest)) !== null) hits.push({ key: fm[1].toLowerCase().replace(/\s+/g, ' '), at: fm.index, end: fm.index + fm[0].length });
    for (let h = 0; h < hits.length; h++) {
      const key = META_KEYS[hits[h].key];
      if (!key) continue;
      const raw = rest.slice(hits[h].end, h + 1 < hits.length ? hits[h + 1].at : rest.length);
      const val = trimWrappers(raw).replace(/[;·]+$/, '').trim();
      if (key === 'paths') {
        for (const p of splitTopLevel(val, ',')) meta.paths.push(...expandBraces(stripTicks(p)));
      } else if (key === 'dependsOn') {
        // sem NONE_RE: `—`, "nenhuma", "n/a" e vazio simplesmente não contêm `TASK-NN`, então a
        // extração devolve lista vazia por si. A guarda anterior era lógica morta.
        for (const d of val.match(/TASK-0*[0-9]+/gi) || []) meta.dependsOn.push(normId(Number(d.replace(/\D/g, ''))));
      } else {
        // traces/exposes preservam o token cru: `design DD-11`, `ADR 0016 decisão 2`, `LDG-0084`
        // e `DEFER-01` aparecem no mesmo campo que os REQ, e descartá-los perderia rastreio.
        for (const t of splitTopLevel(val, ',')) meta[key].push(stripTicks(t));
      }
    }
    // título: o que vem antes do primeiro campo reconhecido — ou a linha toda, quando não há
    // metadados (formato que existe em planos reais e não pode ser descartado em silêncio)
    // o `(` que abria o bloco de metadados fica no fim do recorte do título — apara-se junto com a
    // pontuação decorativa, sem tocar parêntese que faça parte do texto ("(bits 2, 35)")
    const title = trimWrappers(hits.length ? rest.slice(0, hits[0].at) : rest).replace(/[\s;·(]+$/, '').trim();
    // hasMeta responde "a linha declarou ALGUM campo reconhecido?", que é diferente de "algum
    // campo tem valor". `depende: —` deixa dependsOn vazio exatamente como a omissão total, e sem
    // esta distinção o TSK-06 puniria quem declarou independência — que é a declaração correta.
    const hasMeta = hits.some((h) => META_KEYS[h.key]);
    tasks.push({ id: normId(n), n, status, wave, title, traces: meta.traces, paths: meta.paths, dependsOn: meta.dependsOn, exposes: meta.exposes, hasMeta, line: i + 1 });
  });
  return { tasks, waves };
}

// ── TSK-01..04 ───────────────────────────────────────────────────────────────────────────────
// Substitui a auto-checagem de `commands/specs/tasks.md` §2. Todos bloqueiam: são fatos
// estruturais sobre o próprio artefato, decidíveis sem olhar código nem ambiente.
export function checkTasksGraph(parsed) {
  const tasks = (parsed && parsed.tasks) || [];
  const findings = [];
  const at = (t) => `tasks.md:${t.line}`;
  const byId = new Map();
  const dupes = [];
  for (const t of tasks) {
    if (byId.has(t.id)) dupes.push(t); else byId.set(t.id, t);
  }

  // TSK-04 — duplicata e furo. Numeração com furo esconde task perdida em rebase/merge; ID
  // duplicado faz duas tasks disputarem a mesma aresta.
  for (const d of dupes)
    findings.push({ code: 'TSK-04', enforceable: true, msg: `${at(d)}: ${d.id} duplicado (já declarado em tasks.md:${byId.get(d.id).line})` });
  if (byId.size) {
    const ns = [...byId.values()].map((t) => t.n).sort((a, b) => a - b);
    const missing = [];
    for (let i = 1; i <= ns[ns.length - 1]; i++) if (!byId.has(normId(i))) missing.push(normId(i));
    // Furo AVISA, duplicata BLOQUEIA. A assimetria é deliberada: ID duplicado é sempre defeito (duas
    // tasks disputam a mesma aresta), enquanto furo é ambíguo — pode ser task perdida num merge, mas
    // também é o resultado de remover uma task SEM renumerar, que é a operação segura (renumerar
    // invalida referências já gravadas em commits, PRs e stories). Bloquear empurraria o autor para
    // a operação perigosa.
    if (missing.length)
      findings.push({ code: 'TSK-04', enforceable: false, msg: `tasks.md: furo na numeração — ${missing.length} ID(s) ausente(s) entre TASK-01 e ${normId(ns[ns.length - 1])}: ${missing.join(', ')}` });
  }

  // TSK-01 — dependência pendurada, e TSK-03 — dependência para wave posterior.
  for (const t of tasks) {
    for (const d of t.dependsOn) {
      const dep = byId.get(d);
      if (!dep) {
        findings.push({ code: 'TSK-01', enforceable: true, msg: `${at(t)}: ${t.id} depende de ${d}, que não existe em tasks.md` });
        continue;
      }
      if (t.wave !== null && dep.wave !== null && dep.wave > t.wave)
        findings.push({ code: 'TSK-03', enforceable: true, msg: `${at(t)}: ${t.id} (Wave ${t.wave}) depende de ${dep.id} (Wave ${dep.wave}) — dependência para wave posterior, ordem topológica inválida` });
    }
  }

  // TSK-02 — ciclo. DFS com pilha explícita de caminho, para que a mensagem mostre ONDE cortar:
  // "há um ciclo" sem o caminho obriga o autor a refazer o trabalho do detector à mão.
  const state = new Map();     // id → 'visiting' | 'done'
  const reported = new Set();
  const path = [];
  const walk = (id) => {
    const t = byId.get(id);
    if (!t) return;
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      const cut = path.indexOf(id);
      const cycle = [...path.slice(cut), id];
      const key = [...cycle].slice(0, -1).sort().join('>');
      if (!reported.has(key)) {
        reported.add(key);
        findings.push({ code: 'TSK-02', enforceable: true, msg: `tasks.md:${t.line}: ciclo de dependência — ${cycle.join(' → ')}` });
      }
      return;
    }
    state.set(id, 'visiting');
    path.push(id);
    for (const d of t.dependsOn) walk(d);
    path.pop();
    state.set(id, 'done');
  };
  for (const t of byId.values()) walk(t.id);

  // TSK-05 — "não consegui verificar" tem que ser DITO. Sem nenhuma wave reconhecível, TSK-03 passa
  // por vacuidade, e um gate que não rodou é indistinguível de um gate que passou. Avisa (não
  // bloqueia): plano pequeno sem waves é estado legítimo, mas quem lê o veredito precisa saber que a
  // ordem topológica entre waves não foi conferida.
  const withDeps = tasks.filter((t) => t.dependsOn.length);
  if (withDeps.length && tasks.every((t) => t.wave === null))
    findings.push({ code: 'TSK-05', enforceable: false, msg: `tasks.md: nenhum cabeçalho de wave reconhecido (esperado "## Wave N — …") — as ${withDeps.length} dependências declaradas NÃO foram verificadas contra ordem de wave (TSK-03 não pôde rodar)` });

  // TSK-06 — a outra metade do mesmo princípio do TSK-05, e a que faltava: sem NENHUM bloco de
  // metadados o grafo não tem aresta, e um grafo sem arestas é um grafo sem defeitos. TSK-01/02/03
  // não encontram nada para reprovar e o plano é aprovado sem ter sido verificado. Todo achado
  // deste módulo nasce de um fato PRESENTE no artefato (aresta pendurada, ciclo, ordem invertida,
  // ID duplicado); esta é a ausência que precisa virar achado, senão o caminho mais fácil para
  // passar nos checks é não declarar nada.
  //
  // A assimetria entre bloquear e avisar segue a de TSK-04 (duplicata bloqueia, furo avisa):
  // omissão SISTEMÁTICA é o artefato inteiro não alimentando o check, e o conserto — escrever o
  // bloco — é seguro e barato; omissão PONTUAL é plausivelmente uma task trivial, e bloquear ali
  // empurraria para anotação decorativa, que polui o grafo sem informar nada.
  //
  // O predicado é `hasMeta` (a linha declarou algum campo?), nunca `dependsOn.length` (a lista tem
  // item?): `depende: —` é declaração explícita de independência e produz lista vazia igual à
  // omissão total. Punir os dois do mesmo jeito ensinaria a não declarar.
  const semMeta = tasks.filter((t) => !t.hasMeta);
  if (tasks.length > 1 && semMeta.length) {
    if (semMeta.length === tasks.length) {
      findings.push({
        code: 'TSK-06', enforceable: true,
        msg: `tasks.md: nenhuma das ${tasks.length} tasks declara metadados (esperado "(rastreia: …; paths: …; depende: …)") — sem aresta declarada, TSK-01 (dependência pendurada), TSK-02 (ciclo) e TSK-03 (ordem entre waves) não verificaram nada e passaram por vacuidade`,
      });
    } else {
      findings.push({
        code: 'TSK-06', enforceable: false,
        msg: `tasks.md: ${semMeta.length} de ${tasks.length} task(s) sem bloco de metadados (${semMeta.map((t) => t.id).join(', ')}) — as dependências dessas tasks não entraram no grafo; declare "depende: —" quando de fato não houver`,
      });
    }
  }

  return findings.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : a.msg < b.msg ? -1 : 1));
}

// ── Checklist de cobertura de superfície ─────────────────────────────────────────────────────
// Sem `$` ancorado: `## Checklist de cobertura de superfície (obrigatório)` continua sendo a seção.
// Exigir o título exato fazia um sufixo qualquer desligar o SRF-01 inteiro, sem uma palavra.
const CHECKLIST_RE = /^#{1,6}\s*Checklist de cobertura de superf[íi]cie\b/im;

// parseSurfaceChecklist(text) → [{ req, param, surface, tasks, line }].
//
// Duas decisões de reconhecimento, ambas aprendidas de falso positivo/negativo observado:
//   - a linha é de DADOS quando a primeira célula é um `REQ-NN`. Contar "a primeira linha de tabela
//     é o cabeçalho" quebrava com uma segunda tabela na mesma seção: o cabeçalho dela virava linha
//     de dados, e o achado saía com o texto "Superfície (tela/endpoint/CLI)" como se fosse um REQ.
//   - o que denuncia o esqueleto do template é o `TASK-NN` LITERAL na coluna de tasks, não a
//     presença de `<...>`. Descartar toda linha com `<...>` matava rota parametrizada
//     (`GET /v1/itens/<id>`) e comparação numérica (`timeout <= 30s`) — conteúdo legítimo cuja
//     ausência desligava o check sem aviso.
export function parseSurfaceChecklist(text) {
  const src = String(text || '');
  const m = CHECKLIST_RE.exec(src);
  if (!m) return [];
  const startLine = src.slice(0, m.index).split('\n').length;
  const body = src.slice(m.index + m[0].length).split('\n');
  const rows = [];
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    if (/^#{1,6}\s/.test(line)) break;                       // próxima seção encerra a tabela
    if (!/^\s*\|/.test(line)) continue;
    if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;         // separador
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length && cells[0] === '') cells.shift();
    if (cells.length && cells[cells.length - 1] === '') cells.pop();
    if (cells.length < 4) continue;
    const reqM = /^REQ-0*([0-9]+)$/i.exec(cells[0]);
    if (!reqM) continue;                                     // cabeçalho, prosa, ou célula composta
    if (/\bTASK-NN\b/.test(cells[3])) continue;              // esqueleto do template
    rows.push({
      req: `REQ-${cells[0].replace(/\D/g, '').padStart(2, '0')}`,
      param: cells[1],
      surface: cells[2],
      tasks: [...new Set((cells[3].match(/TASK-0*[0-9]+/gi) || []).map((d) => normId(Number(d.replace(/\D/g, '')))))],
      line: startLine + i + 1,
    });
  }
  return rows;
}

// SRF-03 — a célula de superfície que fala em endpoint precisa CITAR o endpoint (LDG-0010).
//
// A medição de 2026-08-04 contra o repositório de referência mostrou que 64% dos achados SRF-01
// caem em células escritas em prosa ("endpoints de publicação no bff + tela admin"), e sobre prosa
// o oráculo de rota não tem o que cruzar: não dá para dizer se o endpoint não existe (defeito de
// código) ou se a task declarou `paths:` incompleto (defeito de declaração). Enquanto a célula não
// citar `VERB /path`, o SRF-01 não pode ser promovido a bloqueante — o que falta não é o oráculo,
// é o insumo.
//
// Nasce como AVISO, deliberadamente: promover direto inundaria specs já escritas, e um gate que
// chega bloqueando o passado é um gate que a pessoa desliga. Superfície que não é de API (tela,
// CLI, flag de config) não é cobrada — pedir endpoint onde não há endpoint transformaria o check
// num formulário.
export function checkSurfaceChecklistLiteral(rows) {
  const findings = [];
  for (const r of rows || []) {
    const cel = String(r.surface || '');
    if (!namesApiSurface(cel)) continue;          // não fala em endpoint/rota: nada a cobrar
    if (VERB_PATH_RE.test(cel)) continue;          // já cita o literal
    findings.push({
      code: 'SRF-03',
      enforceable: false,
      msg: `requirements.md:${r.line}: ${r.req} declara superfície de API em prosa ("${cel.slice(0, 60)}") sem citar o endpoint no formato "VERB /path" — sem o literal, a cobertura não pode ser cruzada contra as rotas que o código expõe, e o SRF-01 fica limitado a um veredito por REQ`,
    });
  }
  return findings;
}

// SRF-02 — o Checklist é incondicional no template. Requirements com `## REQ-` e sem a seção (ou com
// a seção vazia) significa que o SRF-01 não rodou, e isso tem que aparecer: a diferença entre "não
// há lacuna de superfície" e "ninguém olhou" é a diferença que este módulo existe para eliminar.
export function checkSurfaceChecklistPresence(reqText) {
  const src = String(reqText || '');
  if (!/^#{1,6}\s*REQ-/im.test(src)) return [];              // artefato sem REQ: nada a exigir
  const rows = parseSurfaceChecklist(src);
  if (rows.length) return [];
  const missing = !CHECKLIST_RE.test(src);
  return [{
    code: 'SRF-02',
    enforceable: false,
    msg: missing
      ? 'requirements.md: seção "## Checklist de cobertura de superfície" ausente — a cobertura de superfície (SRF-01) NÃO foi verificada'
      : 'requirements.md: "Checklist de cobertura de superfície" sem nenhuma linha preenchida (só esqueleto do template) — a cobertura de superfície (SRF-01) NÃO foi verificada',
  }];
}

// namesApiSurface(s): a coluna "Superfície" nomeia endpoint/rota HTTP?
//
// Deliberadamente ESTREITO. Não casa "api" solto, porque `contracts/openapi/…` e
// `…-configs-api.v1.yaml` são DECLARAÇÃO de contrato, não superfície implementada — casá-los
// transformaria toda linha que cita o contrato em achado, e um gate que acusa 20 linhas de 26 é
// um gate que o adotante desliga na primeira semana.
export function namesApiSurface(s) {
  const v = String(s || '');
  // um path concreto ou um verbo HTTP é evidência positiva forte — vale mesmo com negação em volta
  if (/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b[^|]{0,60}\/[A-Za-z0-9_{@<-]/.test(v)) return true;
  if (/(^|[\s`("'])\/(api|v[0-9]+|internal)\//i.test(v)) return true;
  // POLARIDADE: o template de requirements INSTRUI a escrever a negação explícita em vez de omitir a
  // linha ("diga 'sem parâmetro exposto' em vez de omitir"). Sem esta guarda, a forma que o próprio
  // harness pede vira achado — ruído previsível, na linha que o autor escreveu por obediência.
  if (/\b(sem|nenhum[ao]?|não|nao)\b[^|]{0,20}\b(endpoints?|rotas?|routes?)\b/i.test(v)) return false;
  if (/\bn\/a\b/i.test(v) && !/\bendpoints?\b/i.test(v.replace(/\bn\/a\b[^|]*/i, ''))) return false;
  if (/\bendpoints?\b|\brotas?\b|\broutes?\b/i.test(v)) return true;
  return false;
}

// Contrato declarado NÃO é superfície implementada — um arquivo em `contracts/` promete a rota,
// não a produz. Tratá-lo como produtor é exatamente o defeito que o SRF-01 procura.
const CONTRACT_PATH_RE = /(^|\/)(contracts?|openapi|asyncapi|proto|pact)(\/|$)/i;
const TEST_PATH_RE = /(^|\/)(tests?|__tests__|spec|e2e)(\/|$)|\.(spec|test|tests)\./i;
// ESTREITO por necessidade. A versão anterior emprestava o vocabulário de `layerOf()` do
// graph-build, que classifica `web/`, `ui/`, `views/` como camada de apresentação — resposta certa
// para "que camada é esta?" e errada para "isto registra rota HTTP?". O efeito medido: uma task em
// `frontend/web/src/Lista.tsx` contava como produtora de endpoint, e o REQ que prometia rota coberto
// só por tela ficava verde. O oráculo passava a mascarar exatamente o defeito que existe para achar.
// Ficam: segmento de diretório inequívoco, e o sufixo PONTUADO de projeto .NET (`Acme.Transport.Api/`).
const API_PATH_RE = /(^|\/)(api|apis|controllers?|routes?|endpoints?)(\/|$)|\.(api|web|host|gateway|bff|presentation)(\/|$)/i;
const VERB_PATH_RE = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b\s+\/[A-Za-z0-9_{@/<-]+/;

function pathTouches(taskPath, target) {
  const a = taskPath.replace(/\/+$/, ''); const b = String(target).replace(/\/+$/, '');
  return a === b || b.startsWith(`${a}/`) || a.startsWith(`${b}/`);
}

// producesSurface(task, opts): a task, COMO DECLARADA, produz superfície HTTP?
//   opts.apiPaths — paths que o grafo de código classifica `layer:api` (quando o grafo existe).
// Sem grafo, resta a heurística de nome de path e o verbo+path no título. Conservador por
// construção: a dúvida resolve para "não produz", e o veredito por REQ (abaixo) é o que impede
// que esse conservadorismo vire falso positivo.
export function producesSurface(task, opts = {}) {
  const apiPaths = opts.apiPaths || [];
  for (const p of task.paths || []) {
    // contrato PROMETE a rota, teste a EXERCITA — nenhum dos dois a produz. Tratá-los como
    // produtores é a forma do próprio defeito que o SRF-01 procura.
    if (CONTRACT_PATH_RE.test(p) || TEST_PATH_RE.test(p)) continue;
    if (API_PATH_RE.test(p)) return true;
    if (apiPaths.some((t) => pathTouches(p, t))) return true;
  }
  if (VERB_PATH_RE.test(task.title || '')) return true;
  // `expõe:` (convenção aditiva) declara o path explicitamente — precisão sem preço de entrada.
  if ((task.exposes || []).length) return true;
  return false;
}

// SRF-00 — a porta de saída por omissão.
//
// Todo o resto desta família (REQ-13: mapa endpoint→ação→recurso→policy, mapa de eventos auditáveis,
// e o SRF-01 abaixo) é condicionado a `affects_surfaces` incluir `api`. Um check que só roda quando o
// change se declara sujeito a ele é um check OPCIONAL — e a omissão não acontece ao acaso: acontece
// justamente no change grande, que é onde ela custa mais. No repositório que motivou este módulo, o
// maior change de API não declara `affects_surfaces`, e por isso nunca foi obrigado a preencher o
// mapa endpoint→policy.
//
// BLOQUEIA, e aqui não há a ambiguidade que rebaixa o SRF-01: a afirmação é sobre o que o change
// TOCA, verificável nos paths declarados pelas próprias tasks e no manifest — não depende de saber
// se uma rota existe no código. E a correção é acrescentar uma linha ao manifest.
export function checkSurfaceDeclaration(manifest, parsed, opts = {}) {
  const man = manifest || {};
  const declared = Array.isArray(man.affects_surfaces) ? man.affects_surfaces.map(String) : [];
  if (declared.includes('api')) return [];

  const apiPaths = opts.apiPaths || [];
  const paths = new Set();
  for (const t of (parsed && parsed.tasks) || []) for (const p of t.paths) paths.add(p);
  for (const p of Array.isArray(man.affected_paths) ? man.affected_paths : []) paths.add(String(p));

  const apiFiles = [...paths].filter((p) => !TEST_PATH_RE.test(p) && !CONTRACT_PATH_RE.test(p)
    && (API_PATH_RE.test(p) || apiPaths.some((t) => pathTouches(p, t))));
  const contracts = [...paths].filter((p) => /(^|\/)contracts?\/(openapi|asyncapi)(\/|$)/i.test(p));
  const verbTasks = ((parsed && parsed.tasks) || []).filter((t) => VERB_PATH_RE.test(t.title || ''));
  if (!apiFiles.length && !contracts.length && !verbTasks.length) return [];

  // A contagem e os exemplos existem para que a mensagem ENSINE onde olhar: "declare api" sozinho
  // devolve ao autor o trabalho de descobrir por que o gate acha que ele toca API.
  const ev = [];
  if (apiFiles.length) ev.push(`${apiFiles.length} path(s) de API (ex.: ${apiFiles.slice(0, 3).join(', ')})`);
  if (contracts.length) ev.push(`${contracts.length} contrato(s) de API (ex.: ${contracts.slice(0, 3).join(', ')})`);
  if (verbTasks.length) ev.push(`${verbTasks.length} task(s) com verbo HTTP + path no título (ex.: ${verbTasks.slice(0, 2).map((t) => t.id).join(', ')})`);
  return [{
    code: 'SRF-00',
    enforceable: true,
    msg: `manifest.yaml: affects_surfaces não inclui "api", mas o change toca superfície de API — ${ev.join('; ')}. Declare "affects_surfaces: [api]" (REQ-13), que é o que exige os mapas endpoint→ação→recurso→policy e de eventos auditáveis; sem a declaração, esses requisitos são opt-out por omissão`,
  }];
}

// SRF-01 — substitui o item 6 de `commands/specs/analyze.md`. Veredito POR REQ: reprova quando a
// linha declara superfície de endpoint e NENHUMA das tasks que a cobrem produz superfície.
//
// `enforceable: false` por decisão de calibração, não por timidez: a evidência de que a linha
// está errada é a declaração das tasks, e uma task pode entregar endpoint declarando `paths:`
// incompleto — caso observado no change que motivou este módulo. Enquanto o cruzamento com as
// rotas REAIS do código não existir (SUR-01, próxima onda), o achado é "revise esta linha", não
// "seu plano está inválido". Passa a bloquear quando houver oráculo de código para confirmá-lo.
export function checkSurfaceCoverage(rows, parsed, opts = {}) {
  const tasks = (parsed && parsed.tasks) || [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const findings = [];
  for (const row of rows || []) {
    if (!namesApiSurface(row.surface)) continue;
    const covering = row.tasks.map((id) => byId.get(id)).filter(Boolean);
    if (covering.some((t) => producesSurface(t, opts))) continue;
    const missing = row.tasks.filter((id) => !byId.has(id));
    const detail = row.tasks.length
      ? `nenhuma das tasks que a cobrem produz superfície (${row.tasks.join(', ')}${missing.length ? `; ausentes em tasks.md: ${missing.join(', ')}` : ''})`
      : 'nenhuma task declarada na coluna "Coberto por task"';
    findings.push({
      code: 'SRF-01',
      enforceable: opts.enforceable === true,
      msg: `requirements.md:${row.line}: ${row.req} declara superfície de endpoint/rota ("${row.surface.replace(/\s+/g, ' ').slice(0, 80)}") e ${detail}`,
    });
  }
  return findings;
}
