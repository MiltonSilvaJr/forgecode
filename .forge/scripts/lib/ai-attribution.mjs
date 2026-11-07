// ai-attribution — detecção de assinatura de IA em mensagem de commit, corpo de PR e issue.
//
// O problema concreto: ferramentas de IA acrescentam sua própria marca ao trabalho — trailer
// `Claude-Session:`, `Co-Authored-By: Claude <noreply@anthropic.com>`, rodapé "🤖 Generated with".
// O histórico do repositório passa a atribuir a uma ferramenta autoria que é do humano que
// decidiu, revisou e assumiu a mudança. Desligar isso por configuração não basta: a configuração
// é por máquina e por conta, some num clone novo, num runner de CI ou numa sessão que a ignore —
// e o commit já entrou no histórico quando alguém percebe. Por isso a proibição é verificada no
// repositório, onde o histórico de fato mora.
//
// A DECISÃO CENTRAL DE DESIGN é a detecção ser ESTRUTURAL, nunca textual solta. Um `grep -i claude`
// reprovaria "feat(adapters): materializar o adapter claude", e num repositório que documenta
// ferramentas de IA — como este — o gate viraria imediatamente `--no-verify` de hábito, que é pior
// do que não ter gate. Então só duas coisas violam:
//
//   1. um TRAILER (bloco `Key: value` no fim da mensagem) cuja chave ou valor identifica uma
//      ferramenta de IA — é ali, e só ali, que a atribuição de autoria é declarada; e
//   2. um MARCADOR DE GERAÇÃO inequívoco em qualquer linha ("🤖 Generated with", "Generated with
//      [Claude Code]"), que não tem leitura inocente possível.
//
// Mencionar Claude, Codex ou anthropic.com em prosa é livre, inclusive com link.
//
// Zero-dep (só builtins). Sem I/O: quem lê arquivo e decide exit code é check-ai-attribution.sh.

// Identidades de ferramenta reconhecidas em chave OU valor de trailer. A lista é aberta por
// desenho — cobre os agentes em uso hoje e o padrão genérico `*-session`/`generated-by` pega os
// que ainda não existem, porque a regra é sobre a prática, não sobre um fornecedor.
const AI_IDENTITIES = [
  'claude', 'anthropic', 'codex', 'openai', 'chatgpt', 'gpt-4', 'gpt-5',
  'copilot', 'cursor', 'gemini', 'bard', 'devin', 'aider', 'windsurf', 'sourcegraph amp',
];

// Chaves de trailer que declaram autoria/ferramenta. `co-authored-by` e `signed-off-by` só violam
// quando o VALOR é uma IA — um co-autor humano é legítimo e comum.
const AUTHORSHIP_KEYS = new Set(['co-authored-by', 'signed-off-by', 'author', 'on-behalf-of']);
const TOOL_KEY_RE = /^(.*-)?(session|generated-by|generated|assistant|agent|ai)$/i;

// Marcadores de geração: inequívocos em qualquer posição da mensagem.
const GENERATION_MARKERS = [
  /🤖\s*generated/i,
  /generated\s+with\s+\[?\s*(claude|codex|copilot|cursor|gemini|chatgpt|openai)/i,
  /co-?authored-?by:\s*[^\n]*\b(claude|codex|copilot|cursor|gemini|chatgpt)\b/i,
  /noreply@(anthropic|openai)\.com/i,
];

const TRAILER_RE = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/;

function isAiValue(value) {
  const v = value.toLowerCase();
  return AI_IDENTITIES.some((id) => v.includes(id));
}

// Bloco de trailers: as linhas finais contíguas que casam `Key: value`, ignorando linhas em branco
// no fim. É a convenção do git (git-interpret-trailers) e é o que delimita "declaração de autoria"
// de "prosa". Retorna [{lineNo, key, value}] em ordem de arquivo.
export function extractTrailers(message) {
  const lines = message.split('\n');
  let end = lines.length - 1;
  while (end >= 0 && lines[end].trim() === '') end--;
  if (end < 0) return [];
  let start = end;
  while (start >= 0) {
    const line = lines[start];
    if (line.trim() === '') break;
    if (!TRAILER_RE.test(line)) {
      // linha não-trailer dentro do bloco: só é tolerada como continuação indentada
      if (!/^[ \t]+\S/.test(line)) break;
    }
    start--;
  }
  const out = [];
  for (let i = start + 1; i <= end; i++) {
    const m = lines[i].match(TRAILER_RE);
    if (m) out.push({ lineNo: i + 1, key: m[1], value: m[2] });
  }
  return out;
}

// Retorna as violações encontradas: [{lineNo, line, reason}]. Vazio = mensagem limpa.
export function findAiAttribution(message) {
  const violations = [];
  const lines = message.split('\n');
  const seen = new Set();

  const push = (lineNo, reason) => {
    if (seen.has(lineNo)) return;
    seen.add(lineNo);
    violations.push({ lineNo, line: (lines[lineNo - 1] || '').trim(), reason });
  };

  for (const { lineNo, key, value } of extractTrailers(message)) {
    const k = key.toLowerCase();
    if (TOOL_KEY_RE.test(k) && isAiValue(`${k} ${value}`)) {
      push(lineNo, `trailer '${key}' identifica uma ferramenta de IA`);
      continue;
    }
    if (AUTHORSHIP_KEYS.has(k) && isAiValue(value)) {
      push(lineNo, `trailer '${key}' atribui autoria a uma ferramenta de IA`);
      continue;
    }
    if (/claude\.ai|anthropic\.com|openai\.com|cursor\.sh|copilot/i.test(value)) {
      push(lineNo, `trailer '${key}' aponta para uma ferramenta de IA`);
    }
  }

  lines.forEach((line, i) => {
    if (GENERATION_MARKERS.some((re) => re.test(line))) {
      push(i + 1, 'marcador de geração por IA');
    }
  });

  return violations.sort((a, b) => a.lineNo - b.lineNo);
}
