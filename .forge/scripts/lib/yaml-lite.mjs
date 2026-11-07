// Tiny YAML subset parser shared by the zero-dep forge scripts (validate-spec,
// validate-archive, delta-apply). Accepts the format the forge scripts emit:
// 2-space indentation, `key: value` scalars, nested maps, `key: []` inline empty
// lists, `key: [a, b]` inline flow-style lists of scalars, `- scalar` items and
// `- key: value` object-list items with continuation lines. No inline maps (`{a: b}`
// beyond the literal empty `{}`), no nested flow lists, no multiline strings, no anchors.
// Escapa um escalar para emissão como string YAML entre aspas duplas — contraparte de
// emissão do subset acima, compartilhada pelos emissores (delta-apply, spec-delta-scaffold).
export function yamlQuote(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// yamlFlowList(arr) → texto `[a, b, "c, d"]` — contraparte de emissão para o parser de flow
// style abaixo (LDG-0033). Aspeia só quando necessário: vazio, espaço líder/final, vírgula ou
// colchete/chave embutidos, aspas embutidas, "#" (quebraria stripTrailingComment se solto no
// meio do valor), ou um literal ambíguo (true/false/null/~/inteiro) que senão viraria outro
// tipo na volta. round-trip garantido por tests/w162-yaml-lite-flow-array-gate.sh [4] (PBT).
function needsFlowQuote(s) {
  if (s === '') return true;
  if (/^\s|\s$/.test(s)) return true;
  if (/[,[\]{}"'#]/.test(s)) return true;
  if (s === 'true' || s === 'false' || s === 'null' || s === '~') return true;
  if (/^-?[0-9]+$/.test(s)) return true;
  return false;
}

export function yamlFlowList(arr) {
  const items = (arr || []).map((v) => {
    if (v === null || v === undefined) return '~';
    if (typeof v === 'boolean' || typeof v === 'number') return String(v);
    const s = String(v);
    return needsFlowQuote(s) ? yamlQuote(s) : s;
  });
  return `[${items.join(', ')}]`;
}

// Remove um comentário final de linha (" #…") de um escalar já trimado, respeitando
// aspas simples/duplas — só corta quando o "#" é precedido por espaço FORA de aspas.
// Não mexe em "#" colado ao início do valor (ex.: "#fff", "#tag" sem espaço antes),
// nem em "#" dentro de string entre aspas (ex.: "a # b").
function stripTrailingComment(s) {
  let inSingle = false, inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (c === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (c === '#' && !inSingle && !inDouble && i > 0 && s[i - 1] === ' ') {
      return s.slice(0, i - 1).trimEnd();
    }
  }
  return s;
}

// splitFlowItems(inner) — separa o CONTEÚDO de um `[...]` (sem os colchetes) em itens de topo,
// respeitando aspas simples/duplas: uma vírgula DENTRO de um valor aspeado não separa elementos
// (o caso clássico que quebra parser ingênuo de flow-style — `["a, b", c]` são 2 itens, não 3).
function splitFlowItems(inner) {
  const items = [];
  let cur = '', inSingle = false, inDouble = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '"' && !inSingle) { inDouble = !inDouble; cur += c; continue; }
    if (c === "'" && !inDouble) { inSingle = !inSingle; cur += c; continue; }
    if (c === ',' && !inSingle && !inDouble) { items.push(cur); cur = ''; continue; }
    cur += c;
  }
  items.push(cur);
  return items;
}

// parseFlowSequence(inner) — `inner` é o texto ENTRE os colchetes de um `[...]` já reconhecido
// pelo chamador. Cada item vira escalar via coerceScalar (mesmas regras de tipagem de um valor
// solto: aspas, bool, null, inteiro) — sem suporte a lista/mapa aninhado (fora do subset).
function parseFlowSequence(inner) {
  if (inner.trim() === '') return [];
  return splitFlowItems(inner).map((item) => coerceScalar(item.trim()));
}

// coerceScalar(s) — tipagem de um escalar JÁ trimado e SEM comentário final (a extração do
// comentário só faz sentido uma vez, no texto completo da linha — nunca por item de uma lista
// flow-style, que já veio recortado de dentro desse texto). Compartilhada por parseScalar
// (nível de linha) e parseFlowSequence (nível de item), para as duas rotas concordarem em tipo.
function coerceScalar(s) {
  if (s === '' || s === 'null' || s === '~') return null;
  if (s === '{}') return {};
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?[0-9]+$/.test(s)) return parseInt(s, 10);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  if (s.startsWith('[') && s.endsWith(']')) return parseFlowSequence(s.slice(1, -1));
  return s;
}

export function parseScalar(raw) {
  const s = stripTrailingComment(raw.trim()).trim();
  return coerceScalar(s);
}

export function parseYamlSubset(text) {
  const lines = text.split('\n').map((l) => l.replace(/\t/g, '  '))
    .filter((l) => l.trim() && !l.trim().startsWith('#'));
  const doc = {};
  const frames = [{ indent: -1, obj: doc }];
  let lastKey = null, lastKeyOwner = null, lastKeyIndent = -1;
  const listStack = []; // [{ dashIndent, arr }] — supports returning to an outer list after nested ones

  for (const rawLine of lines) {
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();

    if (line === '-' || line.startsWith('- ')) {
      while (listStack.length && indent < listStack[listStack.length - 1].dashIndent) listStack.pop();
      let ctx = listStack.length && listStack[listStack.length - 1].dashIndent === indent
        ? listStack[listStack.length - 1] : null;
      if (!ctx) {
        if (lastKey === null || indent <= lastKeyIndent) throw new Error(`stray list item: "${line}"`);
        if (!Array.isArray(lastKeyOwner[lastKey])) lastKeyOwner[lastKey] = [];
        ctx = { dashIndent: indent, arr: lastKeyOwner[lastKey] };
        listStack.push(ctx);
      }
      const rest = line === '-' ? '' : line.slice(2);
      const m = rest.match(/^([A-Za-z0-9_-]+):(.*)$/);
      if (m) {
        const item = {};
        item[m[1]] = parseScalar(m[2]);
        ctx.arr.push(item);
        while (frames.length > 1 && indent <= frames[frames.length - 1].indent) frames.pop();
        frames.push({ indent, obj: item });
        lastKey = m[1]; lastKeyOwner = item; lastKeyIndent = indent;
      } else {
        ctx.arr.push(parseScalar(rest));
      }
      continue;
    }

    while (listStack.length && indent <= listStack[listStack.length - 1].dashIndent) listStack.pop();
    while (frames.length > 1 && indent <= frames[frames.length - 1].indent) frames.pop();
    const container = frames[frames.length - 1].obj;

    const m = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (!m) throw new Error(`unparseable line: "${line}"`);
    const [, key, rest] = m;

    if (rest.trim() === '') {
      container[key] = {}; // provisional: becomes [] if "- " items follow
      frames.push({ indent, obj: container[key] });
    } else {
      container[key] = parseScalar(rest);
    }
    lastKey = key; lastKeyOwner = container; lastKeyIndent = indent;
  }
  return doc;
}
