#!/usr/bin/env python3
# scan-native-controls.py <src_dir>
# A4 — scanner determinístico ADVISORY (nunca bloqueia, exit sempre 0) que distingue controle
# nativo do browser DOMADO de NÃO DOMADO, por análise de árvore e nunca por regex sobre o texto.
#
# Parser (decisão): JSX/TSX é lido pela AST do @babel/parser, chamado via Node pelo helper
# scan-native-controls-ast.mjs ao lado deste arquivo — escolhido porque é um arquivo único sem
# dependência em runtime e com API estável, enquanto o pacote `typescript` 7 deixou de expor o
# createSourceFile; o harness o declara só como devDependency (o gate precisa dele) e, no consumidor,
# o helper o resolve a partir do projeto escaneado. .vue/.svelte/.html são lidos pelo
# html.parser da stdlib (tags, atributos, <style> e <script> de topo), e os imports dos blocos
# <script> pelo mesmo helper. O html.parser não entende interpolação de template, então .vue com
# `{{` e .svelte com `{` fora dos blocos de topo (texto, atributo, spread) saem inteiros como WARN
# "não analisado" (fail-closed), assim como <template lang="pug"> (ou qualquer lang que não seja html). CSS (arquivo irmão, <style> JSX ou de SFC) é lido por um tokenizador
# próprio que respeita comentários, strings e aninhamento SCSS (`&` resolvido contra o seletor pai).
#
# Controle nativo: <input type=file|color|date|time|datetime-local|month|week|range|checkbox|radio>,
# <select>, <textarea>, <input type={dinâmico}>, <input> com spread ({...p} ou v-bind="obj") depois
# do type ou sem type, e componente com type nativo literal. É DOMADO só se:
#   (1) está DENTRO de um elemento cujo nome vem de import de caminho com 'design-system' — um
#       ancestral na árvore que o contém pelos filhos (irmão, atributo ou texto não envolvem) —, ou
#       o próprio elemento é esse componente. Tag HTML (<input>, <div>) nunca é componente do DS,
#       mesmo com import homônimo; nome do DS sombreado por binding local (parâmetro, variável,
#       função) não é o componente; DS sob v-pre (Vue) não é compilado e não envolve; ou
#   (2) um escape de aparência real alcança o controle: regra incondicional (fora de @media,
#       @supports, @container, @scope) e com ao menos uma declaração, do CSS irmão com o nome do
#       componente (X.css/X.module.css/.scss/.less para X.tsx), de <style> do próprio arquivo, ou o
#       style inline do controle. Pseudo-elemento do tipo (::-webkit-color-swatch,
#       ::file-selector-button, ::-webkit-file-upload-button, ::-webkit-slider-thumb...) cujo
#       composto-sujeito não tem outra tag, classe fora do controle, id, atributo alheio nem
#       pseudo-classe; ou propriedade (appearance/-webkit-appearance/-moz-appearance: none para
#       checkbox, radio, select e textarea; accent-color para checkbox e radio) numa regra cujo
#       sujeito é a tag do controle, classe usada nele ou [type=<tipo>], sem pseudo-elemento nem
#       pseudo-classe. Classe do controle é só a estática, e casa por ORIGEM da regra: className /
#       class literal só com CSS global (X.css não-module, <style> sem `module`); classe de módulo
#       (styles.x / styles["x"] quando `styles` é o default import do ./X.module.css irmão e não é
#       redeclarado; $style.x no Vue) só com o .module.* importado (ou o <style module> do nome).
#       Depois do ponto só identificador JS ($style.a-b é subtração; hífen só por $style['a-b']).
#       Seletor sem classe (tag, atributo, pseudo solto) de um .module.* vale como global; seletor
#       cujo sujeito está sob :global (:global(.x), :global .x ou bloco :global { .x {} }) é global:
#       casa classe literal, nunca classe de módulo. Spread depois de className/style apaga classe e
#       style conhecidos. Cascata na mesma origem: para o mesmo seletor, a última declaração de
#       appearance (aliases -webkit-/-moz- incluídos) ou accent-color vence; sobrescrita condicional
#       com outro valor apaga a propriedade.
# Tudo o mais: WARN. Arquivo que o parser não lê (erro de sintaxe, interpolação de template, Node
# ou @babel/parser ausente): WARN "não analisado", nunca OK.
#
# Limites conhecidos: JSX montado por função, variável ou string em outro ponto não é seguido (o
# controle fica sem envoltório → WARN); clsx(...) e template com expressão não domesticam; os
# compostos ancestrais do seletor (`.wrap` em `.wrap .sw`) não são confrontados com o DOM real;
# .sass (sintaxe indentada) não tem regras legíveis; o envolvimento em .vue/.svelte só conta com
# fechamento explícito da tag do DS; a cascata só compara o mesmo seletor textual (especificidade e
# !important não entram) e, entre arquivos da mesma origem, usa a ordem de leitura.
import json
import pathlib
import re
import shutil
import subprocess
import sys
from html.parser import HTMLParser

HELPER = pathlib.Path(__file__).with_name("scan-native-controls-ast.mjs")

INPUT_TYPES = {
    "file", "color", "date", "time", "datetime-local", "month", "week", "range", "checkbox", "radio",
}
_PICKER = {"-webkit-calendar-picker-indicator"}
# tipo de controle -> pseudo-elementos (normalizados) que domam o chrome nativo
TAME_PSEUDOS = {
    "file": {"file-selector-button", "-webkit-file-upload-button"},
    "color": {"-webkit-color-swatch", "-webkit-color-swatch-wrapper", "-moz-color-swatch"},
    "date": _PICKER, "time": _PICKER, "datetime-local": _PICKER, "month": _PICKER, "week": _PICKER,
    "range": {"-webkit-slider-thumb", "-moz-range-thumb"},
    "select": {"picker(select)"},
    "textarea": {"-webkit-resizer"},
}
APPEARANCE = ("appearance", "webkitappearance", "mozappearance")
INERT = {"", "auto", "initial", "unset", "inherit", "revert", "revert-layer"}


def _appearance_none(decls: dict) -> bool:
    return decls.get("appearance") == "none"


def _accent(decls: dict) -> bool:
    return "accentcolor" in decls and decls["accentcolor"] not in INERT


TAME_PROPS = {
    "checkbox": lambda d: _appearance_none(d) or _accent(d),
    "radio": lambda d: _appearance_none(d) or _accent(d),
    "select": _appearance_none,
    "textarea": _appearance_none,
}
CSS_EXTS = (".css", ".scss", ".sass", ".less")
JSX_LANG = {".tsx": "tsx", ".ts": "ts", ".jsx": "jsx", ".js": "jsx"}
MARKUP_EXTS = (".vue", ".svelte", ".html")
# só para decidir se um arquivo NÃO analisável merece WARN (pode conter controle) ou silêncio
CONTROL_HINT = re.compile(r"<\s*(input|select|textarea)\b|\btype\s*=|v-bind", re.I)
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr", "param"}


# ---------------------------------------------------------------- CSS (tokenizador, não regex)
def _norm_prop(prop: str) -> str:
    # appearance, -webkit-appearance e -moz-appearance são aliases da mesma propriedade: uma chave só,
    # para que a última declaração (na regra ou na cascata) vença
    key = prop.strip().lower().replace("-", "")
    return "appearance" if key in APPEARANCE else key


def parse_decls(chunks) -> dict:
    out = {}
    for chunk in chunks:
        if ":" not in chunk:
            continue
        prop, val = chunk.split(":", 1)
        prop = prop.strip()
        if not prop or any(ch.isspace() or ch in "{}&" for ch in prop):
            continue
        val = val.strip().lower()
        if val.endswith("!important"):
            val = val[: -len("!important")].strip()
        out[_norm_prop(prop)] = val
    return out


def split_top(text: str, seps: str) -> list:
    # divide em `seps` fora de (), [] e strings
    parts, buf, depth, quote = [], [], 0, ""
    for ch in text:
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = ""
            continue
        if ch in "\"'":
            quote = ch
        elif ch in "([":
            depth += 1
        elif ch in ")]":
            depth = max(0, depth - 1)
        elif ch in seps and depth == 0:
            parts.append("".join(buf))
            buf = []
            continue
        buf.append(ch)
    parts.append("".join(buf))
    return parts


def _resolve(prelude: str, parents: list) -> list:
    parts = [p.strip() for p in split_top(prelude, ",") if p.strip()]
    if not parents:
        return [p.replace("&", "") for p in parts]
    out = []
    for parent in parents:
        for p in parts:
            out.append(p.replace("&", parent) if "&" in p else f"{parent} {p}")
    return out


_KEEP_AT = {"media", "supports", "layer", "container", "document", "scope"}
# at-rules que só valem sob condição (viewport, suporte, contêiner, escopo): regra dentro delas não
# domestica — o controle fica cru fora da condição. @layer vale sempre.
_COND_AT = {"media", "supports", "container", "document", "scope"}


def parse_css(text: str, line_comments: bool) -> list:
    """[(seletores resolvidos, declarações, condicional?)] — comentários e strings nunca viram regra."""
    rules = []
    n = len(text)
    pos = [0]

    def block(parents, cond=False):
        buf, chunks, paren = [], [], 0
        while pos[0] < n:
            i = pos[0]
            c = text[i]
            if text.startswith("/*", i):
                end = text.find("*/", i + 2)
                pos[0] = n if end < 0 else end + 2
                continue
            if line_comments and paren == 0 and text.startswith("//", i):
                end = text.find("\n", i)
                pos[0] = n if end < 0 else end
                continue
            if c in "\"'":
                j = i + 1
                while j < n and text[j] not in (c, "\n"):
                    j += 2 if text[j] == "\\" else 1
                buf.append(text[i : j + 1])
                pos[0] = j + 1
                continue
            if text.startswith("#{", i):  # interpolação SCSS: nunca abre bloco
                end = text.find("}", i)
                end = n - 1 if end < 0 else end
                buf.append(text[i : end + 1])
                pos[0] = end + 1
                continue
            pos[0] = i + 1
            if c == "(":
                paren += 1
            elif c == ")":
                paren = max(0, paren - 1)
            elif c == ";" and paren == 0:
                chunks.append("".join(buf))
                buf = []
                continue
            elif c == "{":
                prelude = "".join(buf).strip()
                buf = []
                if prelude.startswith("@"):
                    name = prelude[1:].split(None, 1)[0].lower() if len(prelude) > 1 else ""
                    child = parents if name in _KEEP_AT else None
                    child_cond = cond or name in _COND_AT
                    decls = block(child, child_cond)
                    if child:  # @media dentro de regra aninhada: declarações valem para o pai
                        rules.append((child, decls, child_cond))
                elif parents is None or not prelude:
                    block(None, cond)
                else:
                    sels = _resolve(prelude, parents)
                    rules.append((sels, block(sels, cond), cond))
                continue
            elif c == "}":
                chunks.append("".join(buf))
                return parse_decls(chunks)
            buf.append(c)
        chunks.append("".join(buf))
        return parse_decls(chunks)

    while pos[0] < n:
        block([])
    return rules


def _read_ident(s: str, i: int):
    j = i
    while j < len(s):
        ch = s[j]
        if ch == "\\" and j + 1 < len(s):
            j += 2
            continue
        if ch.isalnum() or ch in "-_" or ord(ch) > 127:
            j += 1
            continue
        break
    return s[i:j].replace("\\", ""), j


def _read_group(s: str, i: int, open_ch: str, close_ch: str):
    # s[i] == open_ch → (conteúdo, índice após o fechamento) respeitando aninhamento e strings
    depth, quote, j = 0, "", i
    while j < len(s):
        ch = s[j]
        if quote:
            if ch == quote:
                quote = ""
        elif ch in "\"'":
            quote = ch
        elif ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return s[i + 1 : j], j + 1
        j += 1
    return None, len(s)


def subject_compound(selector: str) -> str:
    pieces = [p for p in split_top(selector, " \t\n>+~") if p.strip()]
    return pieces[-1].strip() if pieces else ""


def parse_compound(comp: str):
    """composto → dict, ou None quando algo não é reconhecido (fail-closed)."""
    info = {"element": None, "classes": set(), "ids": False, "attrs": [], "pclasses": 0, "pelement": None}
    i = 0
    if comp.startswith("*"):
        info["element"] = "*"
        i = 1
    elif comp and (comp[0].isalpha() or comp[0] in "-_"):
        name, i = _read_ident(comp, 0)
        info["element"] = name.lower()
    while i < len(comp):
        ch = comp[i]
        if ch == "." or ch == "#":
            name, j = _read_ident(comp, i + 1)
            if not name:
                return None
            if ch == ".":
                info["classes"].add(name)
            else:
                info["ids"] = True
            i = j
        elif ch == "[":
            inner, i = _read_group(comp, i, "[", "]")
            if inner is None:
                return None
            info["attrs"].append(inner.strip())
        elif comp.startswith("::", i):
            if info["pelement"] is not None:
                return None
            name, j = _read_ident(comp, i + 2)
            if j < len(comp) and comp[j] == "(":
                arg, j = _read_group(comp, j, "(", ")")
                name = f"{name}({(arg or '').strip()})"
            info["pelement"] = name.lower()
            i = j
        elif ch == ":":
            _, j = _read_ident(comp, i + 1)
            if j < len(comp) and comp[j] == "(":
                _, j = _read_group(comp, j, "(", ")")
            info["pclasses"] += 1
            i = j
        else:
            return None
    return info


def _type_attr_matches(attr: str, ctype: str):
    # [type=color], [type="color"], [type='color' i] → True; [type^=c], [data-x] → False
    if "=" not in attr:
        return False
    name, value = attr.split("=", 1)
    name = name.strip().lower()
    if not name or name[-1] in "~|^$*" or name != "type":
        return False
    value = value.strip()
    if value[-2:].lower() in (" i", " s"):
        value = value[:-2].strip()
    value = value.strip("\"'").lower()
    return value == ctype


def reaches(comp, ctrl: dict, kind: str, classes: set) -> bool:
    # `classes`: as classes do controle que a ORIGEM da regra pode nomear (literais para CSS global,
    # as do objeto de módulo para o .module.* dele; vazio para módulo sem objeto referenciado)
    if comp is None or comp["ids"]:
        return False
    if comp["element"] not in (None, "*", ctrl["tag"]):
        return False
    if not comp["classes"] <= classes:
        return False
    if not all(_type_attr_matches(a, ctrl["type"]) for a in comp["attrs"]):
        return False
    if comp["pclasses"]:
        return False  # :hover, :checked... domam só um estado
    if kind == "pseudo":
        return comp["pelement"] in TAME_PSEUDOS.get(ctrl["type"], set())
    if comp["pelement"] is not None:
        return False  # declaração vale para o pseudo-elemento, não para o controle
    return comp["element"] == ctrl["tag"] or bool(comp["classes"]) or bool(comp["attrs"])


def _sel_key(sel: str) -> str:
    return " ".join(sel.split())


def effective_props(rules: list) -> dict:
    """seletor -> declarações vigentes depois da cascata dentro da mesma origem: a última declaração
    da propriedade para o MESMO seletor vence. Sobrescrita condicional (@media...) com outro valor
    apaga a propriedade — fora da condição vale um valor, dentro outro, e o controle não fica sempre
    domado (fail-closed)."""
    eff = {}
    for selectors, decls, cond in rules:
        for sel in selectors:
            cur = eff.setdefault(_sel_key(sel), {})
            for prop, val in decls.items():
                if not cond:
                    cur[prop] = val
                elif cur.get(prop) != val:
                    cur.pop(prop, None)
    return eff


def tamed_by_css(ctrl: dict, groups: list) -> bool:
    """groups: [(regras, classes do controle que essas regras podem nomear)]."""
    prop_ok = TAME_PROPS.get(ctrl["type"])
    for rules, classes in groups:
        eff = effective_props(rules)
        for selectors, decls, cond in rules:
            if cond:
                continue  # regra condicional (@media, @supports...) não doma o controle sempre
            for sel in selectors:
                comp = parse_compound(subject_compound(sel))
                if decls and reaches(comp, ctrl, "pseudo", classes):  # pseudo sem declaração não doma nada
                    return True
                if prop_ok and prop_ok(eff[_sel_key(sel)]) and reaches(comp, ctrl, "prop", classes):
                    return True
    return False


def tamed_inline(ctrl: dict) -> bool:
    prop_ok = TAME_PROPS.get(ctrl["type"])
    return bool(prop_ok and prop_ok({_norm_prop(k): str(v).strip().lower() for k, v in ctrl["style"].items()}))


def css_file_rules(path: pathlib.Path) -> list:
    if not path.is_file():
        return []
    return parse_css(path.read_text(errors="ignore"), path.suffix in (".scss", ".less"))


_SCOPE_KW = re.compile(r":(global|local)(?![\w-])", re.I)
_COMBINATORS = " \t\n>+~"


def module_scope(sel: str):
    """CSS Modules: (seletor sem :global/:local, escopo das classes do composto-sujeito), ou None se
    ilegível. Escopo: 'global' (toda classe do sujeito está em :global(...) ou depois de :global sem
    parênteses — inclusive herdado de bloco `:global { }`, que a resolução de aninhamento vira
    `:global .x`), 'local', 'misto' ou 'sem-classe'. Só classe (e id) é renomeada pelo módulo; tag,
    atributo e pseudo não têm escopo."""
    out, flags = [], []
    mode, i, n = False, 0, len(sel)

    def emit(text, flag):
        out.append(text)
        flags.extend([flag] * len(text))

    while i < n:
        m = _SCOPE_KW.match(sel, i)
        if m:
            flag, j = m.group(1).lower() == "global", m.end()
            if j < n and sel[j] == "(":
                inner, j = _read_group(sel, j, "(", ")")
                if inner is None or _SCOPE_KW.search(inner):
                    return None
                emit(inner, flag)
            else:
                mode = flag  # :global / :local sem parênteses vale para o resto do seletor
            i = j
            continue
        if sel[i] in "[(":
            _, j = _read_group(sel, i, sel[i], "]" if sel[i] == "[" else ")")
            if _SCOPE_KW.search(sel[i:j]):
                return None  # :global dentro de :not(...)/:is(...): fora do que o scanner lê
            emit(sel[i:j], mode)
            i = j
            continue
        emit(sel[i], mode)
        i += 1
    norm = "".join(out)
    # início do composto-sujeito: depois do último combinador de topo
    start, depth = 0, 0
    for k, ch in enumerate(norm):
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth = max(0, depth - 1)
        elif depth == 0 and ch in _COMBINATORS:
            start = k + 1
    scopes, depth = set(), 0
    for k in range(start, len(norm)):
        ch = norm[k]
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth = max(0, depth - 1)
        elif depth == 0 and ch in ".#":
            scopes.add(flags[k])
    scope = {frozenset(): "sem-classe", frozenset({True}): "global", frozenset({False}): "local"}.get(
        frozenset(scopes), "misto")
    return norm.strip(), scope


def split_module(rules: list):
    """regras de um CSS Module -> (regras locais, regras globais). Seletor sob :global é global: casa
    classe literal, nunca classe do objeto do módulo; seletor sem classe continua com as locais (que já
    valem sem classe); composto-sujeito misto (classe local e global) não casa nenhuma (fail-closed)."""
    local, glob = [], []
    for selectors, decls, cond in rules:
        loc_s, glob_s = [], []
        for sel in selectors:
            res = module_scope(sel)
            if res is None or res[1] == "misto":
                continue
            (glob_s if res[1] == "global" else loc_s).append(res[0])
        if loc_s:
            local.append((loc_s, decls, cond))
        if glob_s:
            glob.append((glob_s, decls, cond))
    return local, glob


def sibling_css_rules(file_path: pathlib.Path):
    """(regras globais, regras de módulo) do CSS com o nome do componente: X.css (global) e
    X.module.css (módulo), ou equivalente .scss/.less, para X.tsx. Seletor sob :global no módulo vai
    para as globais."""
    stem = file_path.stem
    glob = [r for ext in CSS_EXTS for r in css_file_rules(file_path.with_name(stem + ext))]
    local = []
    for ext in CSS_EXTS:
        loc, g = split_module(css_file_rules(file_path.with_name(stem + ".module" + ext)))
        local += loc
        glob += g
    return glob, local


def css_groups(el: dict, global_rules: list, module_rules: list, by_object: dict) -> list:
    """grupos (regras, classes alcançáveis) por origem: classe literal só com CSS global; classe de
    módulo só com as regras do módulo do próprio objeto; demais regras de módulo só sem classe."""
    groups = [(global_rules, set(el["classes"])), (module_rules, set())]
    per_obj = {}
    for obj, cls in el.get("moduleClasses", []):
        per_obj.setdefault(obj, set()).add(cls)
    for obj, classes in per_obj.items():
        groups.append((by_object.get(obj, []), classes))
    return groups


# ---------------------------------------------------------------- .vue / .svelte / .html
def _norm_tag(name: str) -> str:
    return name.lower().replace("-", "")


# elementos HTML: em .vue/.svelte a tag nativa vence um import homônimo, então nunca é componente do DS
HTML_TAGS = VOID | {
    "a", "abbr", "address", "article", "aside", "audio", "b", "bdi", "bdo", "blockquote", "body", "button",
    "canvas", "caption", "cite", "code", "colgroup", "data", "datalist", "dd", "del", "details", "dfn",
    "dialog", "div", "dl", "dt", "em", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2",
    "h3", "h4", "h5", "h6", "head", "header", "hgroup", "html", "i", "iframe", "ins", "kbd", "label",
    "legend", "li", "main", "map", "mark", "menu", "meter", "nav", "noscript", "object", "ol", "optgroup",
    "option", "output", "p", "picture", "pre", "progress", "q", "rp", "rt", "ruby", "s", "samp", "script",
    "search", "section", "select", "slot", "small", "span", "strong", "style", "sub", "summary", "sup",
    "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead", "time", "title", "tr", "u",
    "ul", "var", "video", "svg", "math",
}


class Markup(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.elements, self.styles, self.scripts = [], [], [], []
        self._raw = None
        # `{` fora de <script>/<style> de topo (texto, nome ou valor de atributo): em .svelte é
        # interpolação/diretiva/spread que o html.parser não entende
        self.braces = False
        # <template lang="pug"> (ou outro lang que não seja html): o corpo não é HTML
        self.foreign = None

    def handle_starttag(self, tag, attrs):
        self._element(tag, attrs, False)

    def handle_startendtag(self, tag, attrs):
        self._element(tag, attrs, True)

    def _element(self, tag, attrs, selfclosing):
        if any("{" in k or "{" in (v or "") for k, v in attrs):
            self.braces = True
        a = dict(attrs)
        if tag == "template" and (a.get("lang") or "html").strip().lower() != "html":
            self.foreign = a.get("lang")
        typ = None
        if "type" in a:
            v = a["type"] or ""
            typ = {"kind": "dynamic"} if v.startswith("{") else {"kind": "literal", "value": v}
        # :type, v-bind:type, :type.prop, .type, :[k] e v-bind="obj" (spread): o tipo vem de expressão
        if any(_binds_type(k) for k in a):
            typ = {"kind": "dynamic"}
        style = parse_decls((a.get("style") or "").split(";"))
        entry = {"tag": tag, "norm": _norm_tag(tag), "closed": False, "vpre": "v-pre" in a}
        self.elements.append({
            "line": self.getpos()[0], "tag": tag, "norm": entry["norm"], "type": typ,
            "classes": (a.get("class") or "").split(), "style": style, "wrappers": list(self.stack),
            "vpre": entry["vpre"], "class_expr": a.get(":class") or a.get("v-bind:class") or "",
        })
        if tag in ("style", "script") and not selfclosing:
            self._raw = (tag, a, [], not self.stack)  # último campo: bloco de topo do arquivo?
        if not selfclosing and tag not in VOID:
            self.stack.append(entry)

    def handle_data(self, data):
        if self._raw:
            self._raw[2].append(data)
        elif "{" in data:
            self.braces = True

    def handle_endtag(self, tag):
        if self._raw and tag == self._raw[0]:
            kind, a, data, top = self._raw
            if kind == "style":
                # <style module> (Vue): regras de módulo, alcançáveis só por $style.x (ou <nome>.x)
                module = ((a.get("module") or "$style") if "module" in a else None)
                self.styles.append((a.get("lang") or "", "".join(data), top, module))
            else:
                self.scripts.append((a.get("lang") or "", "".join(data), top))
            self._raw = None
        for idx in range(len(self.stack) - 1, -1, -1):
            if self.stack[idx]["tag"] == tag:
                self.stack[idx]["closed"] = True  # só o fechamento explícito conta
                del self.stack[idx:]
                break


def _binds_type(name: str) -> bool:
    # v-bind="obj" / v-bind.prop="obj": spread; :type / v-bind:type / .type com modificadores; :[k]
    if name == "v-bind" or name.startswith("v-bind."):
        return True
    for pre in ("v-bind:", ":", "."):
        if name.startswith(pre):
            arg = name[len(pre):]
            return arg.startswith("[") or arg.split(".")[0] == "type"
    return False


# depois do ponto só identificador JS: `$style.color-swatch` é subtração ($style.color - swatch), não a
# classe color-swatch; nome com hífen só por colchete e string ($style['color-swatch'])
_MODULE_REF = re.compile(r"^\s*([A-Za-z_$][\w$]*)\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*(['\"])([\w-]+)\3\s*\])\s*$")


def module_class_of(expr: str, objects) -> list:
    # :class="$style.sw" / :class="$style['sw']" com objeto de <style module> → [[objeto, classe]]
    m = _MODULE_REF.match(expr or "")
    if not m or m.group(1) not in objects:
        return []
    return [[m.group(1), m.group(2) or m.group(4)]]


# ---------------------------------------------------------------- helper Node (AST de JSX)
def run_helper(project: pathlib.Path, requests: list) -> dict:
    if not requests:
        return {}
    node = shutil.which("node")
    fail = None
    if not HELPER.is_file():
        fail = f"helper de AST ausente: {HELPER}"
    elif node is None:
        fail = "Node ausente"
    else:
        try:
            proc = subprocess.run(
                [node, str(HELPER), str(project)], input=json.dumps(requests), capture_output=True,
                text=True, timeout=300,
            )
            if proc.returncode == 0:
                return json.loads(proc.stdout)
            fail = f"helper de AST falhou (rc {proc.returncode}): {_stderr_reason(proc.stderr)}"
        except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as err:
            fail = f"helper de AST falhou: {err}"
    return {r["id"]: {"ok": False, "reason": fail} for r in requests}


def _stderr_reason(stderr: str) -> str:
    # a linha do erro (Error: ..., SyntaxError: ...), não o rodapé "Node.js vXX" do stack trace
    lines = [ln.strip() for ln in stderr.splitlines() if ln.strip()]
    for ln in lines:
        head = ln.split(":", 1)[0]
        if head.endswith("Error") or head == "Error":
            return ln[:300]
    return " | ".join(lines[:3])[:300] or "sem saída de erro"


def control_of(el: dict):
    """(rótulo, tag do controle) para um controle nativo, ou None."""
    typ = el["type"]
    tag = el["tag"]
    if el.get("intrinsic", True) and tag in ("select", "textarea"):
        return tag, tag
    if typ is None or typ["kind"] == "empty":
        return None
    if typ["kind"] == "dynamic":
        return ("type-dinâmico", "input") if tag == "input" else None
    value = typ["value"].strip().lower()
    if value in INPUT_TYPES:
        return value, ("input" if tag == "input" else None)
    return None


def judge(el: dict, groups: list, is_ds, inside_ds: bool):
    """(veredito, rótulo, motivo) — ou None se o elemento não é controle nativo."""
    found = control_of(el)
    if found is None:
        return None
    label, ctag = found
    if is_ds:
        return "OK", label, "o próprio elemento é componente do DS"
    if inside_ds:
        return "OK", label, "encapsulado em componente do DS"
    if ctag is None:
        return "WARN", label, "componente fora do DS com type nativo"
    if label == "type-dinâmico":
        return "WARN", label, "type dinâmico: tipo não determinado, sem encapsulamento no DS"
    ctrl = {"tag": ctag, "type": label, "style": el["style"]}
    if tamed_inline(ctrl):
        return "OK", label, "escape de aparência no style do controle"
    if tamed_by_css(ctrl, groups):
        return "OK", label, "escape de aparência no CSS que alcança o controle"
    return "WARN", label, "sem escape de aparência nem encapsulamento no DS"


def main() -> int:
    if len(sys.argv) < 2:
        print("uso: scan-native-controls.py <src_dir>")
        return 2
    src = pathlib.Path(sys.argv[1])
    if not src.exists():
        print(f"FAIL: src_dir não encontrado: {src}")
        return 2

    files, requests, markups = [], [], {}
    for p in sorted(src.rglob("*")):
        if not p.is_file() or (p.suffix not in JSX_LANG and p.suffix not in MARKUP_EXTS):
            continue
        text = p.read_text(errors="ignore")
        # filtro negativo: sem estas palavras (em qualquer caixa — HTML não distingue <INPUT> de <input>)
        # não há tag de controle nem atributo type
        low = text.lower()
        if not any(w in low for w in ("input", "select", "textarea", "type")):
            continue
        if p.suffix in JSX_LANG:
            files.append(p)
            requests.append({
                "id": f"jsx:{p}", "code": text, "lang": JSX_LANG[p.suffix], "mode": "jsx", "stem": p.stem,
            })
            continue
        m = Markup()
        try:
            m.feed(text)
            m.close()
        except Exception as err:  # noqa: BLE001 — qualquer falha do parser vira "não analisado" (LDG-0232)
            m = f"html.parser falhou: {err}"
        # interpolação de template ({{ }} no Vue; {…} no Svelte, inclusive spread e atributo) é JS que o
        # html.parser lê como texto e tag: '<DsBox>', '<style>' ou '<!--' dentro dela viram nós falsos.
        # Fail-closed: o arquivo inteiro sai não analisado se pode conter controle — o filtro textual só
        # decide entre WARN e silêncio, nunca produz OK.
        if isinstance(m, Markup) and (
            (p.suffix == ".vue" and "{{" in text) or (p.suffix == ".svelte" and m.braces)
        ):
            m = "interpolação de template ({{ }} / {…}) que o html.parser não entende"
        if isinstance(m, Markup) and m.foreign is not None:
            # pug & cia.: o corpo não é HTML, e o CONTROL_HINT (sintaxe HTML) não vale para ele
            files.append(p)
            markups[p] = f'<template lang="{m.foreign}"> não é HTML: o html.parser não lê o template'
            continue
        if not isinstance(m, Markup) and not CONTROL_HINT.search(text):
            continue  # nenhum texto que possa formar controle: não há o que reportar
        files.append(p)
        markups[p] = m
        if isinstance(m, Markup) and p.suffix != ".html":
            for k, (lang, code, top) in enumerate(m.scripts):
                if not top:
                    continue  # <script> dentro do template não é o bloco do componente
                lang = lang.lower() if lang.lower() in ("ts", "tsx") else "js"
                requests.append({"id": f"imp:{p}:{k}", "code": code, "lang": lang, "mode": "imports"})
    results = run_helper(src, requests)

    ok_count = warn_count = 0

    def report(verdict, label, where, why):
        nonlocal ok_count, warn_count
        if verdict == "OK":
            ok_count += 1
        else:
            warn_count += 1
        print(f"{verdict} {label}  {where}  ({why})")

    for p in files:
        if p.suffix in JSX_LANG:
            res = results.get(f"jsx:{p}", {"ok": False, "reason": "sem resposta do helper"})
            if not res.get("ok"):
                report("WARN", "não-analisado", p, f"não analisado: {res.get('reason')}")
                continue
            global_rules, module_rules = sibling_css_rules(p)
            for css in res["styles"]:
                global_rules += parse_css(css, False)  # <style> JSX é folha global
            # objeto do módulo nomeia só as classes locais; as de :global já estão nas globais do irmão
            by_object = {
                obj: split_module(css_file_rules(p.parent / src))[0] for obj, src in res.get("modules", {}).items()
            }
            for el in res["elements"]:
                groups = css_groups(el, global_rules, module_rules, by_object)
                v = judge(el, groups, el["isDs"], el["insideDs"])
                if v:
                    report(v[0], v[1], f"{p}:{el['line']}", v[2])
            continue
        m = markups[p]
        if not isinstance(m, Markup):
            report("WARN", "não-analisado", p, f"não analisado: {m}")
            continue
        ds, ds_fail = set(), None
        sfc = p.suffix != ".html"
        for k, (_, _, top) in enumerate(m.scripts):
            if sfc and not top:
                continue
            res = results.get(f"imp:{p}:{k}", {"ok": False, "reason": "sem resposta do helper"})
            if res.get("ok"):
                ds |= {_norm_tag(n) for n in res["dsNames"]}
            else:
                ds_fail = res.get("reason")
        global_rules, module_rules = sibling_css_rules(p)
        by_object = {}
        for lang, css, top, module in m.styles:
            if sfc and not top:
                continue  # <style> dentro do template de SFC não é a folha do componente
            parsed = parse_css(css, lang.lower() in ("scss", "less"))
            if module is None:
                global_rules += parsed
            else:
                local, glob = split_module(parsed)
                global_rules += glob
                module_rules += local
                by_object.setdefault(module, []).extend(local)

        def from_ds(e):
            return e["tag"] not in HTML_TAGS and e["norm"].split(".")[0] in ds

        for el in m.elements:
            el["intrinsic"] = True
            # v-pre: o Vue não compila o elemento nem os descendentes — DS ali dentro é HTML cru
            chain = el["wrappers"] + [el]
            pre = next((i for i, w in enumerate(chain) if w.get("vpre")), len(chain))
            is_ds = pre == len(chain) and from_ds(el)
            inside = any(w["closed"] and from_ds(w) for w in el["wrappers"][:pre])
            el["moduleClasses"] = module_class_of(el["class_expr"], by_object)
            v = judge(el, css_groups(el, global_rules, module_rules, by_object), is_ds, inside)
            if v is None:
                continue
            if v[0] == "WARN" and ds_fail:
                v = ("WARN", v[1], f"não analisado: imports do <script> não lidos — {ds_fail}")
            report(v[0], v[1], f"{p}:{el['line']}", v[2])

    total = ok_count + warn_count
    if total == 0:
        print("OK controles-nativos: nenhum controle nativo encontrado")
    elif warn_count == 0:
        print(f"OK controles-nativos: {ok_count} controle(s), todos domados/encapsulados")
    else:
        print(f"WARN controles nativos: {warn_count} de {total} controle(s) sem domesticação nem encapsulamento")
    # advisory: nunca bloqueia — a metade bloqueante mora no gate opt-in do consumidor.
    return 0


if __name__ == "__main__":
    sys.exit(main())
