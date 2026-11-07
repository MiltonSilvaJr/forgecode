// scaffold-markers.mjs — lista CANÔNICA dos marcadores de "delta não autorado" (§10.4).
// Um spec-delta.yaml com qualquer um destes marcadores é esqueleto (template do spec-new
// ou scaffold da fase verify), nunca autoria — e não pode chegar ao baseline.
// Consumidores node importam daqui (spec-delta-scaffold, validate-archive, validate-spec).
// Os checks em bash (doctor.sh, spec-verify.sh) carregam uma CÓPIA desta regex por custo
// de processo — ao mudar aqui, atualize os dois (grep por SCAFFOLD_MARKERS nos scripts).
export const SCAFFOLD_MARKERS_RE = /<scaffold:|<capability-kebab>|REQ-XXX-/;
// Subconjunto "pristino do template": só os placeholders do template do spec-new.
// NÃO inclui `<scaffold:` de propósito — um delta já gerado pelo scaffold (que carrega
// `<scaffold: ...>` nos campos a preencher) pode ter edição humana parcial, e regenerá-lo
// descartaria essa autoria. O scaffold só reescreve o que nunca foi gerado/autorado.
export const TEMPLATE_PRISTINE_RE = /<capability-kebab>|REQ-XXX-/;
export const hasScaffoldMarkers = (text) => SCAFFOLD_MARKERS_RE.test(text);
