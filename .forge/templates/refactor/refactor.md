# Refactor — <CHANGE_ID>

> Especificação do refactor `<CHANGE_ID>` — mudança interna **sem alteração intencional de comportamento**.
> Este artefato substitui `requirements.md` no tipo `refactor`. O archive só ocorre se o comportamento preservado foi verificado.

## 1. Invariantes comportamentais (o que NÃO pode mudar)

Lista verificável do comportamento observável que deve permanecer idêntico (contratos, respostas, efeitos colaterais, performance quando relevante).

## 2. Área impactada

Módulos, paths e contratos internos tocados (espelhe em `manifest.yaml > affected_paths`).

## 3. Motivação e resultado esperado

Por que refatorar agora (dívida, acoplamento, preparação para feature X) e como o sucesso será medido.

## 4. Riscos

| Risco | Detecção | Mitigação |
|---|---|---|

## 5. Estratégia de migração

Passos incrementais (cada um com build/testes verdes); estratégia expand-contract quando houver contrato/persistência envolvida.

## 6. Testes de não-regressão

- [ ] Suíte existente verde antes e depois (baseline de comparação)
- [ ] Testes adicionais cobrindo os invariantes da seção 1
- [ ] Verificação de performance quando a seção 1 a declarar invariante
