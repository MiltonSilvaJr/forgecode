---
title: Contrato mínimo de testes por mudança
applies_to:
  - all
priority: high
last_reviewed: 2026-07-22
---

# Contrato mínimo de testes por mudança

O conjunto de testes é definido pelo risco e pela superfície alterada, não por meta de cobertura. A task deve apontar qual destes itens é aplicável e fornecer a evidência correspondente.

- Lógica de domínio ou aplicação: teste de comportamento/invariante; TDD e PBT quando houver propriedade verificável.
- Persistência ou migration: teste de integração contra banco real quando o ambiente estiver disponível; a migration deve fazer parte do caminho exercitado.
- Endpoint com recurso do usuário/tenant: teste positivo e teste negativo de autorização/ownership (IDOR quando aplicável).
- API ou evento: teste de contrato para o consumidor/produtor afetado e cenário de incompatibilidade quando houver versão.
- Tela orientada a dados: loading, sucesso, vazio e erro, além da interação/validação do formulário quando existir.

Mocks substituem fronteiras que o teste não controla, como gateway externo, relógio ou fila. Não usar mock para transformar banco, domínio ou contrato interno em um teste verde sem valor.

Quando um nível de teste do contrato não pode rodar, a ordem de saída é fixa — sempre nesta sequência, nunca invertida, e cada saída só se aplica depois de esgotada a anterior:

1. **Criar o objeto** — monte um harness real e descartável (banco efêmero, container, stub de infraestrutura que exercite o comportamento de verdade) que permita rodar o teste real contra ele, mesmo que o objeto não sobreviva ao change.
2. **Reescrever o critério** — só quando (1) for genuinamente inviável. Reescrever o critério de aceite muda o requisito: é prerrogativa exclusiva do dono humano da spec, com registro nominal de quem decidiu (DA-18). Em modo `yolo`, o `yolo-gate` nunca reescreve o critério por conta própria — ele escala a decisão ao dono.
3. **Registrar a evidência pendente** — só depois de esgotadas (1) e (2): registrar explicitamente a evidência pendente; nunca declarar esse nível de teste aprovado.

Em change de tipo `bugfix`, este contrato é complementado por [`regression-red-first.md`](./regression-red-first.md): o teste de reprodução precisa ter sido observado falhando na árvore pré-correção, com evidência replicável.
