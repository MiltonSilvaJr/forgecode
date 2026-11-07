// secret-scan — detecção de credenciais em texto, zero-dep.
//
// Extraído dos padrões de hooks/pre-tool-use/prevent-secrets-leak.sh para poder ser reusado fora
// de um hook de ferramenta. O primeiro consumidor é `liaison send`: uma mensagem publicada num
// canal sai do repositório e pode acabar num diretório compartilhado, numa branch remota ou —
// com o transporte por issue — num lugar público. Um segredo colado no corpo de uma mensagem é
// um segredo vazado, e diferente de um arquivo local ele não volta atrás depois do push.
//
// Os padrões são deliberadamente conservadores: preferem deixar passar um caso duvidoso a
// reprovar texto legítimo. Um detector barulhento em caminho de escrita frequente é desligado
// pelo usuário na primeira semana, e aí não protege nada.
export const SECRET_PATTERNS = [
  { name: 'AWS Access Key ID', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'AWS Secret Access Key', re: /[aA][wW][sS].{0,20}['"][0-9a-zA-Z/+]{40}['"]/ },
  { name: 'JWT', re: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/ },
  { name: 'chave privada PEM', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'API key de LLM', re: /sk-[a-zA-Z0-9]{20,}/ },
  { name: 'token do GitHub', re: /gh[pousr]_[a-zA-Z0-9]{36}/ },
  { name: 'token do npm', re: /npm_[a-zA-Z0-9]{36}/ },
  { name: 'senha em atribuição', re: /(password|passwd|senha)\s*[:=]\s*['"][^'"\s]{8,}['"]/i },
  { name: 'credencial em connection string', re: /[a-z][a-z0-9+.-]*:\/\/[^:/\s]+:[^@/\s]{6,}@/i },
];

// Retorna os nomes dos padrões que casaram (vazio = limpo).
export function findSecrets(text) {
  const s = String(text || '');
  return SECRET_PATTERNS.filter((p) => p.re.test(s)).map((p) => p.name);
}

// ─────────────────────────────────────────────────────────────────────────────
// Camada do GATE (check-secrets.sh, issue #37) — varredura por LINHA de arquivo
// versionado, com classe, posição e evidência mascarada.
//
// Por que uma segunda camada e não os SECRET_PATTERNS acima: aquela lista responde
// "este texto que estou prestes a PUBLICAR carrega segredo?" e por isso é conservadora e
// booleana. O gate responde outra pergunta — "que segredos já estão VERSIONADOS, onde, e de
// qual classe?" — e precisa de posição (arquivo:linha) para remediar, de classe para priorizar,
// e de elegibilidade por extensão para poder ser agressivo em arquivo de configuração sem
// reprovar prosa. Compartilham o domínio, não o contrato.
//
// Três invariantes que este módulo assume, e que existem porque um gate de segredo é
// trivialmente fácil de escrever verde e inútil:
//   1. NADA de tolerância implícita. Um valor só deixa de ser suspeito se for reconhecidamente
//      placeholder de interpolação ou vazio — nunca por o arquivo "parecer" de teste.
//   2. NADA de comparação vazia. Onde há extração (valor de senha, par usuário:senha do Basic,
//      glob da allowlist), os DOIS lados são validados antes de comparar; string vazia nunca
//      casa com string vazia e produz verde sobre nada.
//   3. Comentário é conteúdo. Nenhuma linha é descartada por começar com #, //, <!-- ou ;.

// Elegibilidade da classe conn-cred: por EXTENSÃO e padrão de nome, nunca por lista enumerada de
// caminhos — ancorar em lista garante que o próximo arquivo criado escape silenciosamente.
const CONN_CRED_FILE_RE = [
  /(^|\/)appsettings[^/]*\.json$/i,
  /\.config$/i,
  /\.ya?ml$/i,
  /\.properties$/i,
  /(^|\/)\.env(\.[^/]+)?$/i,
  /\.env$/i,
];

export function isConnCredFile(path) {
  const p = String(path || '');
  if (!p) return false;                       // invariante 2: caminho vazio não casa com nada
  return CONN_CRED_FILE_RE.some((re) => re.test(p));
}

// Chave de credencial seguida de separador. O `[^A-Za-z0-9]` de borda aceita `DB_PASSWORD=`,
// `spring.datasource.password=` e `User Id=x;Password=y` — e recusa `passwordFrom:`, porque ali
// o separador não vem colado na chave e o valor é quase sempre uma referência.
const CRED_KEY_RE = /(^|[^A-Za-z0-9])(password|passwd|pwd)[ \t]*[:=][ \t]*(.*)$/i;

// Placeholders de interpolação: `${VAR}`, `$VAR`, `{{ .x }}`, `%VAR%`, `<informe>`, `#{x}`,
// `!{x}`, mascaramento (`***`) e os literais de documentação mais comuns. Não é tolerância: é a
// diferença entre um segredo e um template que aponta para o cofre.
const PLACEHOLDER_RE = [
  /^\$/, /^\{\{/, /^%[^%]*%$/, /^<[^>]*>?$/, /^#\{/, /^!\{/, /^\*+$/,
  /^(null|none|true|false|redacted|changeme|change_me|placeholder|todo|tbd|x+|senha|password|secret|your[-_ ]?password)$/i,
];

// Valor extraído do lado direito de `chave=` / `chave:`. Recorta na fronteira de connection
// string (`;`), de markup (`"`, `'`, `<`, `>`) e de lista (`,`).
function extractValue(rest) {
  let v = String(rest || '').trim();
  if (!v) return '';
  const q = v[0];
  if (q === '"' || q === "'") {
    const end = v.indexOf(q, 1);
    v = end > 0 ? v.slice(1, end) : v.slice(1);
  } else {
    v = v.split(/[;,"'<>]/)[0];
  }
  return v.replace(/^[\s]+/, '').replace(/[\s)\]}]+$/, '');
}

// Um valor é segredo quando NÃO é vazio, NÃO é placeholder e tem comprimento plausível.
// O piso de 4 caracteres vem do prevent-secrets-leak.sh e é o mesmo em todo o harness.
function isLiteralSecret(v) {
  if (!v || v.length < 4) return false;                 // invariante 2: vazio nunca vira achado
  if (v.includes('${') || v.includes('{{')) return false;
  return !PLACEHOLDER_RE.some((re) => re.test(v));
}

// Máscara: o gate roda em log de CI e em terminal compartilhado. Ecoar o valor transformaria o
// relatório de vazamento num segundo vazamento — e num canal com retenção maior que o arquivo.
export function maskSecret(v) {
  return `valor mascarado, ${String(v || '').length} car.`;
}

// Cabeçalho PEM de chave privada. Vale em QUALQUER arquivo versionado, não só nos de
// configuração: uma chave colada num README, num .txt de deploy ou num script de provisionamento
// é tão recuperável quanto uma no appsettings. Os cinco hífens de cada lado são exigidos porque é
// o que distingue o formato real de uma menção em prosa — e é o que impede o próprio harness de
// casar consigo mesmo ao documentar o padrão.
const PEM_PRIVATE_KEY_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;

// Tokens de provedor com PREFIXO reconhecível e comprimento fixo. A ancoragem no prefixo mais o
// comprimento é o que torna esta classe utilizável em qualquer arquivo sem virar ruído: um texto
// que menciona `ghp_` ou `AKIA` ao documentar a política não casa, porque não carrega os 36 ou 16
// caracteres seguintes. Detectar entropia genérica faria o oposto — reprovaria hash, UUID e
// lockfile, e o gate seria desligado na primeira semana.
const PROVIDER_TOKEN_RULES = [
  { name: 'token do GitHub', re: /gh[pousr]_[A-Za-z0-9]{36}/ },
  { name: 'AWS Access Key ID', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'API key do Google', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'token do Slack', re: /xox[abprs]-[0-9A-Za-z-]{20,}/ },
  { name: 'chave secreta do Stripe', re: /[sr]k_(live|test)_[0-9A-Za-z]{20,}/ },
  { name: 'token do npm', re: /npm_[A-Za-z0-9]{36}/ },
  { name: 'API key de LLM', re: /sk-(ant|proj)-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}/ },
  { name: 'JWT', re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
];

// `Authorization: Basic <base64>` literal. Aqui mora a invariante 2 na sua forma mais concreta:
// o casamento do regex NÃO basta para declarar achado. Um Basic auth é base64 de `usuário:senha`,
// então o candidato é DECODIFICADO e só vira achado se o resultado for texto imprimível contendo
// `:` com AMBOS os lados não vazios. Sem essa validação, `Basic YWRtaW4=` (que decodifica em
// "admin", sem par) e qualquer palavra de oito letras em prosa virariam credencial — e, no
// sentido inverso, um detector que fatiasse em `:` sem checar as metades compararia vazio com
// vazio e concluiria que encontrou par onde não há nada.
const BASIC_AUTH_RE = /Authorization[ \t]*:[ \t]*Basic[ \t]+([A-Za-z0-9+/]{8,}={0,2})/i;

function decodedBasicPair(b64) {
  let decoded;
  try {
    decoded = Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return null;
  }
  if (!decoded) return null;                             // decodificação vazia: nada a comparar
  if (/[\x00-\x08\x0e-\x1f]/.test(decoded)) return null;  // binário: não é par de texto
  const sep = decoded.indexOf(':');
  if (sep <= 0) return null;                             // sem `:`, ou usuário vazio
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  if (!user || !pass) return null;                       // os DOIS lados, sempre
  return { user, pass };
}

// scanLines(path, text) → [{ cls, lineNo, reason }]. Sem I/O; quem lê arquivo e decide exit
// code é check-secrets.sh.
export function scanLines(path, text) {
  const out = [];
  const lines = String(text == null ? '' : text).split('\n');
  const connEligible = isConnCredFile(path);

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    if (connEligible) {
      const m = line.match(CRED_KEY_RE);
      if (m) {
        const value = extractValue(m[3]);
        if (isLiteralSecret(value)) {
          out.push({ cls: 'conn-cred', lineNo, reason: `credencial de conexão em atribuição '${m[2]}' (${maskSecret(value)})` });
        }
      }
    }

    if (PEM_PRIVATE_KEY_RE.test(line)) {
      out.push({ cls: 'private-key', lineNo, reason: 'cabeçalho de chave privada PEM em arquivo versionado' });
    }

    for (const rule of PROVIDER_TOKEN_RULES) {
      const m = line.match(rule.re);
      if (m) {
        out.push({ cls: 'provider-token', lineNo, reason: `${rule.name} literal (${maskSecret(m[0])})` });
        break;                                   // uma ocorrência por linha basta para remediar
      }
    }

    const ba = line.match(BASIC_AUTH_RE);
    if (ba) {
      const pair = decodedBasicPair(ba[1]);
      if (pair) {
        out.push({ cls: 'basic-auth', lineNo, reason: `Authorization: Basic literal, decodifica em usuário:senha (usuário ${maskSecret(pair.user)}, senha ${maskSecret(pair.pass)})` });
      }
    }
  });

  return out;
}

// ── allowlist por path com justificativa OBRIGATÓRIA em linha ────────────────────────────────
// Formato: `<glob>   # motivo: <justificativa>`. Uma entrada sem motivo é ENTRADA INVÁLIDA e
// reprova o gate — nunca passe livre. Allowlist é o ponto por onde gates de segredo são
// esvaziados na prática; exigir justificativa auditável na própria linha é o que separa exceção
// de erosão.
const MIN_JUSTIFICATION = 12;

export function parseAllowlist(text) {
  const entries = [];
  const errors = [];
  String(text == null ? '' : text).split('\n').forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const hash = line.indexOf('#');
    const glob = (hash >= 0 ? line.slice(0, hash) : line).trim();
    const comment = hash >= 0 ? line.slice(hash + 1).trim() : '';
    if (!glob) { errors.push({ lineNo, reason: 'entrada sem path (glob vazio casaria com tudo)' }); return; }
    const m = comment.match(/^motivo:\s*(.+)$/i);
    if (!m || m[1].trim().length < MIN_JUSTIFICATION) {
      errors.push({ lineNo, reason: `entrada '${glob}' sem justificativa — exige '# motivo: <texto de ao menos ${MIN_JUSTIFICATION} caracteres>'` });
      return;
    }
    entries.push({ lineNo, glob, motivo: m[1].trim() });
  });
  return { entries, errors };
}

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

// allowlistMatch(path, entries) → entrada que isenta o path, ou null. Ambos os lados validados
// antes de comparar (invariante 2): path vazio ou glob vazio nunca casam.
export function allowlistMatch(path, entries) {
  const p = String(path || '');
  if (!p) return null;
  for (const e of entries || []) {
    if (!e || !e.glob) continue;
    if (globToRegExp(e.glob).test(p)) return e;
  }
  return null;
}
