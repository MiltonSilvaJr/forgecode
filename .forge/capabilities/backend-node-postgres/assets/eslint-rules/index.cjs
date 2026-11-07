"use strict";

// Vendorizado de soumatheusgomes/vibe-coding-toolkit (templates/eslint/eslint-rules/index.cjs),
// commit em uso: main @ 2026-09-04. MIT — ver aviso completo em ./utils.cjs e ./core-rules.cjs.
//
// As chaves de regra abaixo (max-lines, no-direct-console, no-direct-data-access) NÃO carregam
// namespace — o namespace é decidido por quem registra o plugin. O upstream registra sob a
// chave `quality`; ../eslint.config.mjs registra sob `forge-quality`, e é esse registro (não
// este arquivo) que muda os ids efetivos para `forge-quality/max-lines` etc.
const {
  maxLines,
  noDirectConsole,
  noDirectDataAccess,
} = require("./core-rules.cjs");

module.exports = {
  meta: { name: "forge-quality", version: "1.0.0" },
  rules: {
    "max-lines": maxLines,
    "no-direct-console": noDirectConsole,
    "no-direct-data-access": noDirectDataAccess,
  },
};
