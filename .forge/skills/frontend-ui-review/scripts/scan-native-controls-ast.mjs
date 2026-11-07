#!/usr/bin/env node
// scan-native-controls-ast.mjs <project_dir> — helper de scan-native-controls.py: lê do stdin um
// JSON [{id, code, lang, mode, stem}] e devolve no stdout um JSON {id: resultado}. Faz a análise de
// JSX/TSX sobre a AST do @babel/parser (resolvido primeiro a partir de <project_dir>, depois a
// partir deste arquivo), nunca sobre o texto: comentário e string não são nós JSX.
//   mode "jsx"     → {ok, elements: [...], styles: [css de <style> JSX], modules: {objeto: "./X.module.css"}}
//   mode "imports" → {ok, dsNames: [...]}   (bloco <script> de .vue/.svelte)
//   falha de parse ou parser ausente → {ok: false, reason}
// Um elemento está DENTRO de um componente do DS só quando um ancestral JSXElement cujo nome vem
// de import de caminho com 'design-system' o contém pelos `children` — atributo não envolve, e tag
// intrínseca (<input>, <div>) nunca é componente do DS, nem um nome do DS sombreado por binding local.
// Classe literal (className="x") e classe de módulo (styles.x, só quando o objeto é o default import do
// ./<stem>.module.css irmão) saem separadas, com o arquivo de origem do módulo: o .py casa a primeira
// só com CSS global e a segunda só com o .module.* importado. Spread {...p} apaga o que veio antes.
// `styles.color-swatch` não é MemberExpression (é subtração), então nunca vira classe: com hífen, só
// `styles["color-swatch"]`.
import { createRequire } from "node:module";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function loadParser(projectDir) {
  const bases = [path.join(path.resolve(projectDir), "__forge__.js"), fileURLToPath(import.meta.url)];
  for (const base of bases) {
    try {
      return createRequire(base)("@babel/parser");
    } catch {
      /* tenta a próxima base */
    }
  }
  return null;
}

function pluginsFor(lang) {
  if (lang === "ts") return ["typescript", "decorators-legacy"];
  if (lang === "tsx") return ["jsx", "typescript", "decorators-legacy"];
  return ["jsx", "decorators-legacy"]; // js, jsx
}

function dsNamesOf(ast) {
  const names = new Set();
  for (const node of ast.program.body) {
    if (node.type !== "ImportDeclaration" || node.importKind === "type") continue;
    if (!String(node.source.value).includes("design-system")) continue;
    for (const spec of node.specifiers) {
      if (spec.importKind === "type") continue;
      names.add(spec.local.name);
    }
  }
  return names;
}

// nome da tag e identificador raiz (`DS.Field` → raiz `DS`); intrínseco = minúscula sem ponto
function tagInfo(nameNode) {
  if (nameNode.type === "JSXIdentifier") {
    const n = nameNode.name;
    return { name: n, root: n, intrinsic: /^[a-z]/.test(n) };
  }
  if (nameNode.type === "JSXMemberExpression") {
    let obj = nameNode;
    const parts = [];
    while (obj.type === "JSXMemberExpression") {
      parts.unshift(obj.property.name);
      obj = obj.object;
    }
    parts.unshift(obj.name);
    return { name: parts.join("."), root: obj.name, intrinsic: false };
  }
  return { name: `${nameNode.namespace.name}:${nameNode.name.name}`, root: "", intrinsic: true };
}

// valor estático de uma expressão (string ou template sem expressões); undefined se dinâmico
function staticString(expr) {
  if (!expr) return undefined;
  if (expr.type === "StringLiteral") return expr.value;
  if (expr.type === "TemplateLiteral" && expr.expressions.length === 0) return expr.quasis[0].value.cooked;
  return undefined;
}

function attrValue(attr) {
  // {kind: "literal", value} | {kind: "dynamic"} | {kind: "empty"}
  const v = attr.value;
  if (v == null) return { kind: "empty" };
  if (v.type === "StringLiteral") return { kind: "literal", value: v.value };
  if (v.type === "JSXExpressionContainer") {
    const s = staticString(v.expression);
    if (s !== undefined) return { kind: "literal", value: s };
  }
  return { kind: "dynamic" };
}

// nomes declarados fora de import (variável, parâmetro, catch, função, classe), em qualquer escopo
function localBindings(ast) {
  const names = new Set();
  function pattern(p) {
    if (!p) return;
    if (p.type === "Identifier") names.add(p.name);
    else if (p.type === "ObjectPattern") for (const q of p.properties) pattern(q.type === "RestElement" ? q.argument : q.value);
    else if (p.type === "ArrayPattern") for (const q of p.elements) pattern(q);
    else if (p.type === "RestElement") pattern(p.argument);
    else if (p.type === "AssignmentPattern") pattern(p.left);
    else if (p.type === "TSParameterProperty") pattern(p.parameter);
  }
  function walk(node) {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "VariableDeclarator") pattern(node.id);
    if (node.type === "CatchClause") pattern(node.param);
    if (/Function|ObjectMethod|ClassMethod|ClassPrivateMethod/.test(node.type) && Array.isArray(node.params)) {
      for (const p of node.params) pattern(p);
    }
    if (/^(FunctionDeclaration|FunctionExpression|ClassDeclaration|ClassExpression)$/.test(node.type) && node.id)
      names.add(node.id.name);
    for (const key of Object.keys(node)) {
      if (key === "loc") continue;
      const val = node[key];
      if (Array.isArray(val)) for (const item of val) walk(item);
      else if (val && typeof val.type === "string") walk(val);
    }
  }
  walk(ast.program);
  return names;
}

// objetos de CSS module que valem como fonte de classe estática: SÓ o default (ou namespace) import
// do .module.css/.scss/.less IRMÃO do próprio componente (./X.module.css para X.tsx), e só se o nome
// não é redeclarado em nenhum escopo do arquivo. Qualquer outro objeto (theme.sw, styles de outro
// módulo) não é classe conhecida. Devolve nome local -> caminho importado.
function moduleNamesOf(ast, stem, locals) {
  const names = new Map();
  if (!stem) return names;
  const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const own = new RegExp(`^\\./${esc}\\.module\\.(css|scss|less)$`);
  for (const node of ast.program.body) {
    if (node.type !== "ImportDeclaration" || !own.test(String(node.source.value))) continue;
    for (const spec of node.specifiers) {
      if (spec.type === "ImportDefaultSpecifier" || spec.type === "ImportNamespaceSpecifier")
        names.set(spec.local.name, String(node.source.value));
    }
  }
  for (const n of locals) names.delete(n);
  return names;
}

// classes estaticamente conhecidas, separadas por origem: literais ("a b", {"a b"}, {`a b`}) em
// `classes`; do CSS module irmão ({styles.a}, {styles["a"]}) em `moduleClasses` como [objeto, classe]
function classesOf(attr, moduleNames) {
  const none = { classes: [], moduleClasses: [] };
  const v = attr.value;
  if (v == null) return none;
  if (v.type === "StringLiteral") return { classes: v.value.split(/\s+/).filter(Boolean), moduleClasses: [] };
  if (v.type !== "JSXExpressionContainer") return none;
  const e = v.expression;
  const s = staticString(e);
  if (s !== undefined) return { classes: s.split(/\s+/).filter(Boolean), moduleClasses: [] };
  if (e.type === "MemberExpression" && e.object.type === "Identifier" && moduleNames.has(e.object.name)) {
    const obj = e.object.name;
    if (!e.computed && e.property.type === "Identifier") return { classes: [], moduleClasses: [[obj, e.property.name]] };
    if (e.computed && e.property.type === "StringLiteral") return { classes: [], moduleClasses: [[obj, e.property.value]] };
  }
  return none;
}

// style={{ appearance: "none", WebkitAppearance: "none", accentColor: "..." }} — só pares estáticos
function styleOf(attr) {
  const out = {};
  const v = attr.value;
  if (!v || v.type !== "JSXExpressionContainer" || v.expression.type !== "ObjectExpression") return out;
  for (const p of v.expression.properties) {
    if (p.type !== "ObjectProperty" || p.computed) continue;
    const key = p.key.type === "Identifier" ? p.key.name : p.key.type === "StringLiteral" ? p.key.value : null;
    const val = staticString(p.value);
    if (key !== null && val !== undefined) out[key] = val;
  }
  return out;
}

function analyzeJsx(ast, stem) {
  // binding local (parâmetro, variável, função, classe) com o nome de um import sombreia o import:
  // <DsBox> com `DsBox` local não é o componente do DS, `styles` local não é o CSS module
  const locals = localBindings(ast);
  const dsNames = dsNamesOf(ast);
  for (const n of locals) dsNames.delete(n);
  const moduleNames = moduleNamesOf(ast, stem, locals);
  const elements = [];
  const styles = [];

  function visitElement(node, wrappers) {
    const opening = node.type === "JSXElement" ? node.openingElement : null;
    if (opening) {
      const info = tagInfo(opening.name);
      const el = {
        line: opening.loc.start.line,
        tag: info.name,
        intrinsic: info.intrinsic,
        // tag intrínseca (<input>, <div>) é sempre o elemento HTML, mesmo com import homônimo do DS
        isDs: !info.intrinsic && dsNames.has(info.root),
        insideDs: wrappers.some((w) => w),
        type: null,
        classes: [],
        moduleClasses: [],
        style: {},
      };
      // atributos em ordem: o último vence, e um spread {...p} pode sobrescrever o que veio antes —
      // type do <input> vira dinâmico, classe e style deixam de ser conhecidos (fail-closed)
      for (const attr of opening.attributes) {
        if (attr.type === "JSXSpreadAttribute") {
          if (info.intrinsic && info.name === "input") el.type = { kind: "dynamic" };
          el.classes = [];
          el.moduleClasses = [];
          el.style = {};
          continue;
        }
        if (attr.type !== "JSXAttribute" || attr.name.type !== "JSXIdentifier") continue;
        const an = attr.name.name;
        // atributo HTML não distingue caixa: <input TYPE="color"> é um input color no DOM
        if (an === "type" || (info.intrinsic && an.toLowerCase() === "type")) el.type = attrValue(attr);
        else if (an === "className" || an === "class") Object.assign(el, classesOf(attr, moduleNames));
        else if (an === "style") el.style = styleOf(attr);
      }
      elements.push(el);
      if (info.name === "style") {
        for (const child of node.children) {
          if (child.type === "JSXText") styles.push(child.value);
          else if (child.type === "JSXExpressionContainer") {
            const s = staticString(child.expression);
            if (s !== undefined) styles.push(s);
          }
        }
      }
      // atributos: percorridos SEM este elemento como envoltório
      walk(opening, wrappers);
      const inner = wrappers.concat([el.isDs]);
      for (const child of node.children) walk(child, inner);
      return;
    }
    // JSXFragment: não é envoltório, só repassa
    for (const child of node.children) walk(child, wrappers);
  }

  function walk(node, wrappers) {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "JSXElement" || node.type === "JSXFragment") {
      visitElement(node, wrappers);
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "leadingComments" || key === "trailingComments" || key === "innerComments")
        continue;
      const val = node[key];
      if (Array.isArray(val)) {
        for (const item of val) if (item && typeof item.type === "string") walk(item, wrappers);
      } else if (val && typeof val.type === "string") {
        walk(val, wrappers);
      }
    }
  }

  walk(ast.program, []);
  return { ok: true, dsNames: [...dsNames], elements, styles, modules: Object.fromEntries(moduleNames) };
}

function main() {
  const projectDir = process.argv[2] || ".";
  const requests = JSON.parse(readFileSync(0, "utf8"));
  const parser = loadParser(projectDir);
  const results = {};
  for (const req of requests) {
    if (!parser) {
      results[req.id] = { ok: false, reason: "@babel/parser indisponível" };
      continue;
    }
    let ast;
    try {
      ast = parser.parse(req.code, {
        sourceType: "module",
        plugins: pluginsFor(req.lang),
        errorRecovery: false,
      });
    } catch (err) {
      const where = err.loc ? ` (linha ${err.loc.line})` : "";
      results[req.id] = { ok: false, reason: `erro de parse${where}: ${String(err.message).split("\n")[0]}` };
      continue;
    }
    results[req.id] = req.mode === "imports" ? { ok: true, dsNames: [...dsNamesOf(ast)] } : analyzeJsx(ast, req.stem);
  }
  process.stdout.write(JSON.stringify(results));
}

main();
