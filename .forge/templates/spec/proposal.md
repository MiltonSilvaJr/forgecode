# Proposal — <CHANGE_ID>

> Change `<CHANGE_ID>` (type: `<CHANGE_TYPE>`, scale <CHANGE_SCALE>) — criado em <CHANGE_DATE> por <CHANGE_OWNER>.
> Preencha as seções abaixo antes de pedir aprovação (`status: proposed` → gate HITL). Marque incertezas com `NEEDS CLARIFICATION`.

## 1. Por quê (problema / motivação)

Descreva o problema ou a oportunidade. Evidência > opinião: cite issue, métrica, feedback ou requisito de negócio.

## 2. O que muda

Descrição objetiva da mudança proposta, em termos de comportamento observável.

## 3. O que NÃO muda (fora de escopo)

Liste explicitamente o que permanece intacto — evita escopo implícito.

## 4. Impacto

- **Capacidades afetadas:** (espelhe em `manifest.yaml > affected_capabilities`)
- **Paths afetados:** (espelhe em `manifest.yaml > affected_paths`)
- **Dependências:** specs/código de que este change depende
- **Riscos:** o que pode dar errado e como detectar cedo

## 5. Próximos passos

Fluxo sugerido para o tipo (`/forge:clarify` → `/forge:requirements` → `/forge:design` → `/forge:tasks` → `/forge:implement` → `/forge:verify`), ajustado pelo `scale` do manifest.
