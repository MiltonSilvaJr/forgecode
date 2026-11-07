// lib/defect-scope.mjs — predicado único de aplicabilidade da política red-first (rule
// testing/regression-red-first.md, issue #138). Antes desta issue, nove sítios repetiam
// `manifest.type === 'bugfix'` de forma independente (red-evidence-ops.mjs ×2,
// check-red-first.mjs ×3, red-evidence.sh ×2, hooks/git/lib/check-red-first.sh ×1,
// spec-verify.sh ×1): um change `type: feature` que corrige um defeito real — sem recategorizar,
// porque o resto do change é trabalho de feature — ficava inteiramente fora da política. A
// escrita (`red-evidence-ops.mjs`) recusava e a leitura (`check-red-first.mjs`) respondia `n/a`
// com rc 0, então nem a cobrança nem o WARN de auditoria enxergavam o defeito.
//
// `fixes_defects` (manifest.yaml, lista de ids de defeito — ver spec-manifest.schema.json)
// estende a aplicabilidade sem recategorizar o change: `isDefectFixing` é `true` quando
// `type === 'bugfix'` OU `fixes_defects` é um array não vazio. Este arquivo é a ÚNICA fonte da
// verdade para essa decisão — os nove sítios foram convertidos para consumi-la (import direto em
// JS; via `node --input-type=module -e "import { isDefectFixing } from '<path>'; ..."` nos três
// sítios em bash, mesmo padrão que `spec-transition.sh` já usa para `quick_plan`).
export function isDefectFixing(manifest) {
  if (!manifest || typeof manifest !== 'object') return false;
  if (manifest.type === 'bugfix') return true;
  const fd = manifest.fixes_defects;
  return Array.isArray(fd) && fd.length > 0;
}

// defectIds(manifest) — ids declarados em `fixes_defects`, normalizados (nunca null/undefined
// nem string vazia). Usado por `evaluateRedFirst` (check-red-first.mjs) para cobrar uma entrada
// de `entries[]` RESOLVIDA (observed|waived) por id declarado — independente de `type`: um
// change com `fixes_defects: [D1, D2]` e evidência só para D1 não pode ficar `fullyResolved`
// só porque a entrada que existe está resolvida; D2 nunca foi olhado.
export function defectIds(manifest) {
  const fd = manifest && manifest.fixes_defects;
  if (!Array.isArray(fd)) return [];
  return fd.filter((id) => typeof id === 'string' && id.length > 0);
}
