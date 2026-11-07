#!/usr/bin/env node
// lib/hooks-manifest.mjs — leitor canônico do `hooks.manifest` de `PreToolUse` (LDG-0178).
//
// POR QUE ESTE MÓDULO EXISTE.
// Dois consumidores escreveram, cada um por conta própria e antes de o produtor chegar, um `hooks.manifest` que declara quais ganchos de `PreToolUse` existem na árvore e quais deles estão fiados no `.claude/settings.json`. Os dois escolheram esquemas de coluna incompatíveis no campo 4: o `axis-fare-validator` põe `universo` ali e prosa de justificativa no campo 5, e o `Axis.PadSimulator` põe `estado` (`armado` ou `retido:<razão>`) e não tem campo 5. Medido por cruzamento dos dois parsers de produção contra os dois manifestos reais em 2026-09-08, o dano é assimétrico: o parser do `axis-fare-validator`, aplicado ao manifesto do `Axis.PadSimulator`, fia quatro ganchos onde o dono fia dois, com rc de sucesso e nenhuma linha de saída, e os dois excedentes são exatamente os dois que o dono reteve com razão medida escrita na linha; o caminho inverso lança nomeando o gancho e o token. Silencioso ao armar demais, barulhento ao recusar.
//
// O FORMATO CANÔNICO v1, que é a UNIÃO dos dois esquemas de campo.
// `universo` e `estado` são propriedades ortogonais e cada adotante acertou metade: um gancho pode estar armado e cego, e pode estar retido com universo largo. A linha canônica é esta, com TAB como separador:
//
//     # forge-manifest-format: 1
//     #hook	matcher	contrato	estado	[chave=valor …]
//     prevent-secrets-leak.sh	^(Write|Edit|MultiEdit|NotebookEdit)$	stdin-json	armado	universo=*	razao=AWS/JWT/PEM antes do byte tocar o disco
//     check-language-policy.sh	^(Write|Edit|MultiEdit|NotebookEdit)$	argv	retido:portao-invertido-le-o-disco-LDG-0387	universo=.cs,.java
//
// Campos 1 a 3 são posicionais e invariantes, porque é o prefixo em que os dois adotantes já concordam campo a campo e vocabulário a vocabulário. O campo 4 é `estado`, posicional, com vocabulário FECHADO — `armado` ou `retido:<razão-curta>` — porque `estado` é o único campo que a fiação consome: errar `estado` arma ou desarma um gancho, errar `universo` não muda a fiação em byte nenhum. O campo que decide segurança fica na posição obrigatória, onde a omissão é um erro de aridade detectável, e não um `chave=valor` que some com um erro de digitação. Do campo 5 em diante são `chave=valor` de conjunto aberto e ordem livre, com `universo=` e `razao=` na v1; chave desconhecida é ignorada e NOMEADA nos avisos, porque nenhuma chave desta faixa participa da fiação e recusar por metadado seria o produtor legislar sobre a prosa do consumidor.
//
// A MIGRAÇÃO É POR PROJEÇÃO, E ELA NÃO PEDE QUE NINGUÉM REESCREVA O ARQUIVO.
// Diante de um `hooks.manifest` SEM a linha de marcador, este leitor opera em modo de projeção: consome apenas os campos 1 a 3, NUNCA lê o campo 4 ou além, e deriva a ativação da fiação já observada no `.claude/settings.json` da própria árvore. Medido nas duas árvores em 2026-09-08, a projeção reproduz exatamente a fiação de hoje sem que ninguém edite um byte, e no `Axis.PadSimulator` os dois inativos derivados são precisamente os dois `retido:` — a informação que o dono escreveu no campo 4 chega ao produtor pelo efeito dela, não pelo texto dela. Nenhum dos dois manifestos instalados tem a linha de marcador, conferido nos dois cabeçalhos inteiros, então nenhuma árvore instalada muda de comportamento até que o dono dela escreva a linha.
//
// TOKEN DESCONHECIDO É FAIL-CLOSED, DENTRO DO FORMATO MARCADO.
// Um valor do campo 4 que não seja `armado` nem `retido:<razão>` faz recusar a leitura inteira, nomeando o gancho e o token. O custo do fail-open é invisível e reativa retenção deliberada; o custo do fail-closed é visível e limitado, porque recusar não desarma nada — o `settings.json` anterior permanece e nenhum gancho que estava armado deixa de estar. É também o que o campo já escolheu: o `sync-adapters.mjs` do `Axis.PadSimulator` lança exatamente nesse caso, e é o único dos dois adotantes que enfrentou a pergunta.
//
// ESTE MÓDULO É PURO E NÃO RECEBE O DIRETÓRIO DE GANCHOS.
// Importá-lo não lê a árvore, não escreve arquivo nenhum e não reescreve a si mesmo — a fiação chega por parâmetro, já desserializada, e o texto do manifesto também. Como ele não recebe o diretório `pre-tool-use/`, ele NÃO enxerga dois desfechos de reconciliação que os dois adotantes tratam localmente: um `.sh` presente no diretório e sem linha declarada no manifesto, e uma linha `armado` cujo `.sh` não existe no disco. Os dois são guardas do gerador, e ficam declarados aqui por escrito para que a ausência seja decisão registrada e não esquecimento. O caso simétrico que este módulo ENXERGA — um `.sh` fiado no `settings.json` sem linha no manifesto — vira aviso nomeado, nunca recusa, porque é o caso real do `dispatch-file-hook.sh` do `axis-fare-validator`.
//
// O CAMPO 3 TAMBÉM TEM VOCABULÁRIO FECHADO NO FORMATO MARCADO, e a assimetria com a projeção é deliberada.
// `contrato` é `argv` ou `stdin-json`, e nada mais. Ele decide COMO o gancho é invocado — por qual canal o payload chega —, e errá-lo entrega ao gancho um canal que ele não sabe ler; o detector do `Axis.PadSimulator` sai por `exit 2` fail-closed exatamente nesse caso. Fechar o campo 4 e deixar aberto o campo 3 seria assimetria de rigor entre dois campos posicionais que ambos governam comportamento. No modo de PROJEÇÃO o mesmo token desconhecido vira AVISO nomeado e nunca recusa, porque ali o leitor está lendo um arquivo que o produtor não escreveu, o campo 3 não participa da derivação da ativação, e recusar a árvore inteira por causa dele quebraria a retrocompatibilidade que é a premissa desta onda.
//
// A FIAÇÃO É TEXTO DE SHELL, E LER SÓ O SUFIXO DE TOKEN SEPARADO POR ESPAÇO ENGOLE GANCHO EM SILÊNCIO.
// Um caminho entre aspas termina em `.sh"`, e dois ganchos encadeados por `;` fazem o primeiro token terminar em `.sh;`: nos dois casos o gancho REALMENTE fiado sumia do conjunto derivado e a projeção o devolvia como INATIVO, com desfecho de sucesso e avisos vazios. O comando é dividido em comandos simples pelos separadores de shell antes de procurar alvo, cada alvo é desencapado, e um comando simples não vazio sem alvo reconhecível não vira silêncio: ele sai em `naoReconhecidos` e a projeção resolve por 'não consegui verificar'. O terceiro estado vale também para o lado da fiação.
//
// FRONTEIRA. Este módulo não fia nada: ele lê e classifica. Quem escreve o `settings.json` é o gerador, e a fiação dele é da Onda L1.

// Os quatro desfechos, com códigos distintos dois a dois. A invariante dos três estados vale para o próprio instrumento: "não encontrei violação", "encontrei violação" e "não consegui verificar" são desfechos diferentes, e a vacuidade é um quarto porque ela não é nenhum dos três — a leitura funcionou, o texto está bem formado, e mesmo assim não há fiação a emitir. Os números seguem a convenção de rc do harness (0 sem violação, 1 com violação, 4 não verificável) e o 5 da vacuidade fica reservado; a tabela consolidada de rc do `update` é fronteira publicada e a alocação final é coordenada com a Onda L1.
export const DESFECHO = Object.freeze({
  OK: 'ok',
  RECUSA: 'recusa',
  NAO_VERIFICADO: 'nao-verificado',
  VACUIDADE: 'recusa-por-vacuidade',
});

export const CODIGO = Object.freeze({
  [DESFECHO.OK]: 0,
  [DESFECHO.RECUSA]: 1,
  [DESFECHO.NAO_VERIFICADO]: 4,
  [DESFECHO.VACUIDADE]: 5,
});

export const MARCADOR = /^#[ \t]*forge-manifest-format:[ \t]*([0-9]+)[ \t]*$/;
export const VERSAO_CANONICA = 1;

// Chaves nomeadas conhecidas da v1. Chave fora desta lista não recusa: ela é ignorada e nomeada nos avisos.
export const CHAVES_V1 = Object.freeze(['universo', 'razao']);

// Vocabulário do campo 3, `contrato`, e ele é FECHADO no formato marcado.
// O campo 3 decide por qual canal o gancho recebe o payload, isto é, ele decide COMO o gancho é invocado: errar `stdin-json` por `argv` entrega ao gancho um canal que ele não sabe ler, e o detector do `Axis.PadSimulator` sai por `exit 2` fail-closed quando o payload não chega pelo canal esperado. Fechar o campo 4 e deixar aberto o campo 3 seria assimetria de rigor entre dois campos posicionais que ambos governam comportamento. Os dois valores são os que as duas árvores instaladas escrevem, medido linha a linha em 2026-09-08, então fechar o vocabulário não recusa nenhuma linha do campo — e, de todo modo, não existe manifesto MARCADO instalado, que é o único lugar onde esta recusa morde.
export const CONTRATOS_V1 = Object.freeze(['argv', 'stdin-json']);

function ehComentario(linha) {
  return /^[ \t]*#/.test(linha);
}

function ehVazia(linha) {
  return /^[ \t]*$/.test(linha);
}

// Divide por TAB SIMPLES, deliberadamente, e não por `\t+`.
// Os dois parsers instalados divergem exatamente aqui, e a divergência tem consequência medida: `split(/\t+/)` colapsa tabulações consecutivas, então numa linha com campo vazio no meio ele PROMOVE a razão do campo 5 ao campo 4 — e sob um leitor que lê o campo 4 como `estado`, prosa de justificativa viraria token de estado. Dividir por TAB simples preserva o campo vazio, a aridade continua correta e o campo vazio cai no vocabulário fechado como token desconhecido, que é fail-closed.
function campos(linha) {
  return linha.replace(/\r$/, '').split('\t');
}

function linhasDeclaradas(texto) {
  const saida = [];
  const linhas = String(texto).split('\n');
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (ehVazia(linha) || ehComentario(linha)) continue;
    saida.push({ numero: i + 1, texto: linha, campos: campos(linha) });
  }
  return saida;
}

// O marcador só vale antes de qualquer declaração: uma linha de comentário no meio ou no fim do arquivo não converte retroativamente um manifesto de campo em canônico.
export function temMarcador(texto) {
  const linhas = String(texto).split('\n');
  for (const linha of linhas) {
    if (ehVazia(linha)) continue;
    if (ehComentario(linha)) {
      const m = linha.replace(/\r$/, '').match(MARCADOR);
      if (m) return { presente: true, versao: Number(m[1]) };
      continue;
    }
    return { presente: false, versao: null };
  }
  return { presente: false, versao: null };
}

// Classificador de dialeto — instrumento de RELATÓRIO, nunca de despacho.
// Ele existe para o censo e para a mensagem ao operador, e a decisão de como ler um manifesto nunca passa por ele: sem marcador o leitor projeta pelos campos 1 a 3 seja qual for a largura, e com marcador ele lê o formato canônico. Detectar o dialeto pela FORMA para decidir a leitura seria fixar por código uma decisão que pertence ao campo, e quebraria no dia em que um valor novo de `universo` colidisse com o vocabulário de `estado` — os dois vocabulários são disjuntos por medição de dois arquivos, não por gramática acordada.
export function classificarDialeto(texto) {
  if (temMarcador(texto).presente) return 'canonico';
  const decls = linhasDeclaradas(texto);
  if (decls.length === 0) return 'nao-classificavel';
  const larguras = new Set(decls.map((d) => d.campos.length));
  if (larguras.size !== 1) return 'nao-classificavel';
  const larg = [...larguras][0];
  if (larg === 5) return 'cinco-campos';
  if (larg === 4) return 'quatro-campos';
  return 'nao-classificavel';
}

function nomeBase(caminho) {
  const partes = String(caminho).split('/');
  return partes[partes.length - 1];
}

// Divide um comando de `PreToolUse` em COMANDOS SIMPLES.
// O campo escreve shell, e shell encadeia comando independente por `;`, `&&`, `||`, `|`, `&` e quebra de linha. Dividir por esses separadores antes de procurar alvo acerta a semântica que a divisão por espaço errava: `a.sh; b.sh` são DOIS ganchos independentes, e não uma ponte seguida de um gancho.
function comandosSimples(comando) {
  return String(comando).split(/;|&&|\|\||\||&|\n/);
}

// Tira do token o que o shell põe em volta do caminho e que não faz parte dele.
// Sem isto, `"$CLAUDE_PROJECT_DIR/.../prevent-secrets-leak.sh"` — higiene de shell perfeitamente comum — produz um token terminado em `.sh"`, que não casa o sufixo e some do conjunto derivado.
function desencapar(token) {
  return String(token).replace(/^[\s'"(]+/, '').replace(/[\s'")]+$/, '');
}

// Deriva, dos blocos de `PreToolUse`, quem é gancho, quem é despachante e o que NÃO foi possível reconhecer.
// A propriedade é ESTRUTURAL e não por nome de arquivo: em cada comando SIMPLES, o gancho é o ÚLTIMO alvo `.sh` e qualquer alvo anterior no mesmo comando simples é despachante. Reconhecer a ponte por ela se chamar `dispatch-*` amarraria o produtor ao vocabulário de uma árvore, e a outra nem tem ponte separada — ela põe a tradução dentro do próprio detector.
//
// O TERCEIRO ESTADO VALE TAMBÉM PARA O LADO DA FIAÇÃO, e é a correção que o review adversarial mediu.
// Um comando simples NÃO VAZIO sem alvo `.sh` reconhecível é 'não consegui reconhecer alvo neste comando', e colapsar isso em 'este comando não fia gancho nenhum' faz o leitor MENTIR sobre o estado do consumidor: um gancho realmente armado na árvore sai classificado como inativo, com desfecho de sucesso e nenhum aviso — o mesmo desarme silencioso pelo qual este item existe, vindo do outro lado. Esses comandos saem em `naoReconhecidos`, e quem projeta resolve por 'não consegui verificar' em vez de por um conjunto.
export function derivarFiacao(blocos) {
  if (!Array.isArray(blocos)) return { legivel: false, ganchos: [], despachantes: [], naoReconhecidos: [] };
  const ganchos = new Set();
  const despachantes = new Set();
  const naoReconhecidos = [];
  for (const bloco of blocos) {
    const entradas = (bloco && Array.isArray(bloco.hooks)) ? bloco.hooks : [];
    for (const entrada of entradas) {
      if (!entrada || typeof entrada.command !== 'string') {
        naoReconhecidos.push('(entrada de PreToolUse sem campo command)');
        continue;
      }
      for (const simples of comandosSimples(entrada.command)) {
        if (simples.trim() === '') continue;
        const alvos = simples.split(/\s+/).map(desencapar).filter((t) => t.endsWith('.sh')).map(nomeBase);
        if (alvos.length === 0) {
          naoReconhecidos.push(simples.trim());
          continue;
        }
        ganchos.add(alvos[alvos.length - 1]);
        for (let i = 0; i < alvos.length - 1; i++) despachantes.add(alvos[i]);
      }
    }
  }
  return { legivel: true, ganchos: [...ganchos], despachantes: [...despachantes], naoReconhecidos };
}

// Uma linha armada precisa de matcher ANCORADO nas duas pontas.
// Medido nos dois adotantes: as duas linhas retidas do `Axis.PadSimulator` têm matcher sem âncora (`Write|Edit`), o que hoje é inofensivo porque o gerador local nunca emite linha retida — mas armar uma delas sem revalidar o matcher entregaria à ferramenta um regex de substring que o próprio cabeçalho daquela árvore documenta como perigoso, com medição própria de `TodoWrite` bloqueando a sessão.
function ancorado(matcher) {
  return typeof matcher === 'string' && matcher.startsWith('^') && matcher.endsWith('$') && matcher.length > 2;
}

function resultado(desfecho, extra) {
  return Object.assign(
    { desfecho, codigo: CODIGO[desfecho], modo: null, declaracoes: [], ativos: [], inativos: [], avisos: [], mensagem: '' },
    extra || {},
  );
}

// Lê um `hooks.manifest` e devolve o conjunto de ganchos ativos, o desfecho e a razão.
//
// texto     — o conteúdo do manifesto, já lido; este módulo não toca o disco.
// opcoes.fiacao — os blocos de `hooks.PreToolUse` do `.claude/settings.json`, já desserializados; `null` ou `undefined` significa "não consegui ler a fiação", que é diferente de `[]`, que significa "li e está vazia".
// opcoes.origem — nome do arquivo de fiação, para que as mensagens de recusa possam nomeá-lo.
export function lerHooksManifest(texto, opcoes) {
  const opts = opcoes || {};
  const origem = typeof opts.origem === 'string' && opts.origem ? opts.origem : '.claude/settings.json';
  const marcador = temMarcador(texto);
  const decls = linhasDeclaradas(texto);
  return marcador.presente
    ? lerCanonico(decls, marcador, origem)
    : projetar(decls, opts.fiacao, origem);
}

function lerCanonico(decls, marcador, origem) {
  const modo = 'canonico';
  if (marcador.versao !== VERSAO_CANONICA) {
    return resultado(DESFECHO.RECUSA, { modo, mensagem: `manifesto marcado com versão de formato ${marcador.versao}, e este leitor conhece apenas a versão ${VERSAO_CANONICA}` });
  }
  const declaracoes = [];
  const ativos = [];
  const inativos = [];
  const avisos = [];
  const vistos = new Set();
  for (const d of decls) {
    const c = d.campos;
    if (c.length < 4) {
      return resultado(DESFECHO.RECUSA, { modo, mensagem: `linha ${d.numero} tem ${c.length} campo(s) e o formato canônico exige pelo menos 4 (hook, matcher, contrato, estado): ${JSON.stringify(d.texto)}` });
    }
    const [hook, matcher, contrato, estado] = c;
    if (!hook) {
      return resultado(DESFECHO.RECUSA, { modo, mensagem: `linha ${d.numero} tem o campo 'hook' vazio` });
    }
    if (vistos.has(hook)) {
      return resultado(DESFECHO.RECUSA, { modo, mensagem: `gancho '${hook}' declarado mais de uma vez, na linha ${d.numero}` });
    }
    vistos.add(hook);
    if (!CONTRATOS_V1.includes(contrato)) {
      return resultado(DESFECHO.RECUSA, { modo, mensagem: `contrato ${JSON.stringify(contrato)} desconhecido para '${hook}' na linha ${d.numero} (use 'argv' ou 'stdin-json')` });
    }
    const nomeados = {};
    for (let i = 4; i < c.length; i++) {
      const campo = c[i];
      if (campo === '') continue;
      const m = campo.match(/^([A-Za-z][A-Za-z0-9_-]*)=([\s\S]*)$/);
      if (!m) {
        return resultado(DESFECHO.RECUSA, { modo, mensagem: `campo ${i + 1} da linha ${d.numero} não é 'chave=valor' para '${hook}': ${JSON.stringify(campo)}` });
      }
      const chave = m[1];
      if (Object.prototype.hasOwnProperty.call(nomeados, chave)) {
        return resultado(DESFECHO.RECUSA, { modo, mensagem: `chave '${chave}' repetida na linha ${d.numero}, para '${hook}'` });
      }
      nomeados[chave] = m[2];
      if (!CHAVES_V1.includes(chave)) avisos.push(`chave desconhecida '${chave}' ignorada na linha ${d.numero}, para '${hook}'`);
    }
    let armado;
    if (estado === 'armado') {
      armado = true;
    } else if (estado.startsWith('retido:')) {
      // `retido:` seco é token malformado, não retenção válida. Sem esta guarda a retenção vira o caminho fácil de desarmar sem justificar, e o valor do campo — decisão auditável em vez de esquecimento — evapora.
      if (estado.slice('retido:'.length).trim() === '') {
        return resultado(DESFECHO.RECUSA, { modo, mensagem: `retenção sem razão para '${hook}' na linha ${d.numero}: 'retido:' seco é malformado, use 'retido:<razão-curta>'` });
      }
      armado = false;
    } else {
      return resultado(DESFECHO.RECUSA, { modo, mensagem: `estado ${JSON.stringify(estado)} desconhecido para '${hook}' na linha ${d.numero} (use 'armado' ou 'retido:<razão>')` });
    }
    if (armado && !ancorado(matcher)) {
      return resultado(DESFECHO.RECUSA, { modo, mensagem: `gancho '${hook}' está armado na linha ${d.numero} com matcher não ancorado ${JSON.stringify(matcher)}: o matcher de linha armada precisa começar em '^' e terminar em '$'` });
    }
    declaracoes.push({ hook, matcher, contrato, estado, armado, nomeados, linha: d.numero });
    (armado ? ativos : inativos).push(hook);
  }
  if (ativos.length === 0) {
    return resultado(DESFECHO.VACUIDADE, { modo, declaracoes, ativos, inativos, avisos, mensagem: `nenhum gancho armado entre ${declaracoes.length} declaração(ões) do manifesto marcado: não há fiação a emitir para '${origem}', e um conjunto vazio devolvido com sucesso seria o desarme silencioso` });
  }
  return resultado(DESFECHO.OK, { modo, declaracoes, ativos, inativos, avisos, mensagem: `${ativos.length} gancho(s) armado(s) e ${inativos.length} retido(s), lidos do formato canônico v${marcador.versao}` });
}

function projetar(decls, fiacao, origem) {
  const modo = 'projecao';
  const declaracoes = [];
  const avisos = [];
  const vistos = new Set();
  for (const d of decls) {
    const c = d.campos;
    if (c.length < 3) {
      return resultado(DESFECHO.RECUSA, { modo, mensagem: `linha ${d.numero} tem ${c.length} campo(s) e a projeção exige pelo menos 3 (hook, matcher, contrato): ${JSON.stringify(d.texto)}` });
    }
    const [hook, matcher, contrato] = c;
    if (!hook) {
      return resultado(DESFECHO.RECUSA, { modo, mensagem: `linha ${d.numero} tem o campo 'hook' vazio` });
    }
    if (vistos.has(hook)) {
      return resultado(DESFECHO.RECUSA, { modo, mensagem: `gancho '${hook}' declarado mais de uma vez, na linha ${d.numero}` });
    }
    vistos.add(hook);
    // O campo 3 é AVISO na projeção e RECUSA no canônico, e a assimetria é a decisão. Aqui o leitor está lendo um arquivo que o produtor não escreveu, o `contrato` não participa da derivação da ativação, e recusar a árvore inteira por um token de campo 3 desconhecido quebraria a retrocompatibilidade que é a premissa central desta onda. No formato marcado o produtor é o dono do formato e o vocabulário fecha.
    if (!CONTRATOS_V1.includes(contrato)) {
      avisos.push(`contrato ${JSON.stringify(contrato)} fora do vocabulário conhecido (${CONTRATOS_V1.join(', ')}) na linha ${d.numero}, para '${hook}': a projeção não consome o campo 3 e por isso não recusa`);
    }
    // O campo 4 e os seguintes NÃO são lidos aqui, e essa omissão é a decisão, não um esquecimento: os dois adotantes discordam sobre o que o campo 4 significa, e ler o campo em disputa é justamente o que fia quatro ganchos onde o dono fia dois.
    declaracoes.push({ hook, matcher, contrato, estado: null, armado: null, nomeados: {}, linha: d.numero });
  }
  const derivada = derivarFiacao(fiacao);
  if (!derivada.legivel) {
    return resultado(DESFECHO.NAO_VERIFICADO, { modo, declaracoes, mensagem: `manifesto sem marcador de formato e fiação não legível em '${origem}': sem a fiação observada não há de onde derivar a ativação, e resolver isso para 'tudo ativo' ou para 'nada ativo' colapsaria o terceiro estado num dos outros dois` });
  }
  // Comando de `PreToolUse` cujo alvo não foi reconhecido é TERCEIRO ESTADO, e não conjunto.
  // Sem esta guarda, um gancho realmente fiado — por caminho entre aspas, por encadeamento, ou porque o comando invoca algo que não é um `.sh` — sai do conjunto derivado sem deixar rastro, e a projeção o classifica como INATIVO com desfecho de sucesso e avisos vazios. É o leitor mentindo sobre o estado do consumidor, e é o mecanismo exato que desarma gancho retido deliberadamente. Quando existe comando irreconhecível, a derivação está incompleta e a resposta honesta é 'não consegui verificar'.
  if (derivada.naoReconhecidos.length > 0) {
    return resultado(DESFECHO.NAO_VERIFICADO, { modo, declaracoes, avisos, mensagem: `${derivada.naoReconhecidos.length} comando(s) de PreToolUse em '${origem}' não têm alvo '.sh' reconhecível — ${JSON.stringify(derivada.naoReconhecidos)} — e a derivação fica incompleta: classificar como inativo um gancho que pode estar fiado seria o desarme silencioso` });
  }
  const ganchos = new Set(derivada.ganchos);
  const ativos = declaracoes.filter((d) => ganchos.has(d.hook)).map((d) => d.hook);
  const inativos = declaracoes.filter((d) => !ganchos.has(d.hook)).map((d) => d.hook);
  for (const g of derivada.ganchos) {
    if (!vistos.has(g)) avisos.push(`'${g}' está fiado em '${origem}' e não tem linha declarada no manifesto`);
  }
  for (const p of derivada.despachantes) {
    avisos.push(`'${p}' é alvo anterior de um comando encadeado e foi tratado como despachante, não como gancho`);
  }
  if (ativos.length === 0) {
    return resultado(DESFECHO.VACUIDADE, { modo, declaracoes, ativos, inativos, avisos, mensagem: `a fiação de '${origem}' é legível e não arma nenhum dos ${declaracoes.length} gancho(s) declarado(s): não há fiação a emitir, e um conjunto vazio devolvido com sucesso seria o desarme silencioso` });
  }
  return resultado(DESFECHO.OK, { modo, declaracoes, ativos, inativos, avisos, mensagem: `${ativos.length} gancho(s) ativo(s) e ${inativos.length} inativo(s), projetados pelos campos 1 a 3 e pela fiação observada em '${origem}'` });
}
