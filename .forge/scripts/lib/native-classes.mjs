// lib/native-classes.mjs — fonte ÚNICA das classes efêmeras, das regex de declaração e dos
// tetos usados pela mensageria nativa entre sessões do Claude Code (design §2.2). Consumida pelo
// gancho de saída (`guard-cross-session-send.sh`), por `native dispose`, por `notify` e pelo
// gate de paridade com a rule (REQ-09) — um único ponto por desenho: alterar a lista aqui sem
// alterar a rule (ou vice-versa) reprova o gate de paridade, nunca diverge em silêncio.
//
// Classes efêmeras: trocas que NÃO precisam virar registro no liaison (rule
// conventions/liaison-protocol.md, seção "Mensageria nativa entre sessões"). Lista FECHADA — o
// gancho recusa qualquer classe fora dela.
export const EPHEMERAL_CLASSES = [
  'identification',
  'presence',
  'schedule',
  'turn-notice',
  'reread-request',
  'internal-coordination',
];

// Declaração de ponteiro canônico na primeira linha não vazia do corpo de um SendMessage para
// destino de sessão (REQ-06): `liaison:<channel>/<msg_id>`. O mesmo formato que `notify` imprime
// como primeira linha — `resolvePointer` (lib/liaison-pointer.mjs) é quem decide se o ponteiro
// resolvido é válido; esta regex só reconhece a FORMA.
export const POINTER_LINE_RE = /^liaison:([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9._-]*)$/;

// Declaração de classe efêmera na primeira linha não vazia: `ephemeral: <class>`. A regex só
// reconhece a FORMA (minúsculas e hífen); pertencer a EPHEMERAL_CLASSES é checado por quem a usa.
export const EPHEMERAL_LINE_RE = /^ephemeral: ([a-z-]+)$/;

// Teto de caracteres para cada subcampo autodeclarado extraído do transcript (from_addr,
// from_name, from_mode — design §2.4 passo 5, mesmo valor do schema liaison-message.schema.json).
export const NATIVE_FIELD_MAX = 128;

// Teto de bytes do texto livre que acompanha um ponteiro ou uma declaração efêmera (exceto
// internal-coordination, que não atravessa repositório e por isso não tem teto próprio — design
// §2.5 etapa 6).
export const NATIVE_EXTRA_TEXT_MAX_BYTES = 1024;
