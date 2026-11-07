---
name: data-cache-practices
description: |
  Boas práticas e catálogo de antipatterns de cache (Redis, Valkey e compatíveis, e cache local em processo), com varredura determinística em scripts/scan.sh: escrita sem TTL, cache local sem expiração, KEYS em código, maxmemory 0 ou noeviction, Redis exposto (protected-mode, bind), campo de cartão em cache e regra de rede aberta na porta 6379. Use ao decidir cache-aside, write-through, TTL e invalidação, proteger contra stampede e chave quente, dimensionar memória e eviction, isolar tenant por namespace, ou quando o data-engineer delegar o domínio de cache. Não use para fila, lock durável ou job (data-streaming), para armazenamento primário ou sessão durável (Redis nunca é fonte de verdade: é CONFLITO com a data-governance.md), nem para NoSQL persistente.
---

# data-cache-practices

Referência do especialista `data-cache`. O conhecimento está em `references/` e foi julgado contra fonte primária (base consolidada do change `data-engineer-agent`, 2026-09-26); cada afirmação carrega a marca de evidência da base: [J] reconferido na fonte primária, [2F] duas fontes, [1F] documentação oficial do produto, [Interp.] interpretação técnica, [Heurística] limiar de partida.

## Escopo

Cache é cópia derivada de outra fonte, para dado lido muitas vezes por escrita e consumidor que tolera consistência eventual. A regra da casa é taxativa: Redis e Memcache nunca são fonte de verdade (`rules/data/data-governance.md`, `rules/data/data-cache.md`); pedido de Redis como armazenamento primário ou de sessão durável é conflito com rule, e a resposta é o bloco `CONFLITO` com a escolha do store durável devolvida ao orquestrador. Fila, lock durável e job em Redis com eviction são antipattern deste domínio, e o desenho da fila é do especialista de mensageria.

## Protocolo

Ordem fixa. É a ordem que torna a resposta auditável.

1. **Escopo.** Liste os paths afetados (código que lê e escreve cache, `redis.conf`, IaC do cluster). Identifique a fonte da verdade de cada chave: sem fonte, não é cache.
2. **Rules do projeto.** Leia `.forge/rules/data/data-cache.md` (namespace por tenant `tenant:{id}:...`, TTL explícito em toda entrada, classes proibidas: segredo, PAN/CVV/track, PII sem máscara, invalidação explícita, serialização versionada, degradação graciosa), a `data-governance.md`, ADRs e baseline. Esta skill não repete a rule: aplica e complementa.
3. **Detecção.** `bash .forge/scripts/check-data-governance.sh --path <path>` (fonte sobre PAN/PII quando o projeto tem `data-classification.json`; interprete pela linha: `CONFLICT` é achado, `universo-vazio` e `node >= 20` são "não verificado") e `bash .forge/skills/data-cache-practices/scripts/scan.sh --root <path> [--root <path>...]`. O detector C-15 é complemento de severidade `aviso`, nunca substituto do verificador de governança.
4. **Julgamento.** Cada `FOUND` é candidato. Chave sem tenant no namespace não tem detector estático confiável (a chave é montada em runtime): é item de revisão obrigatório em cache compartilhado multi-tenant.
5. **Relatório.** Uma linha por regra, inclusive as limpas; todo antipattern apontado cita o id (`C-02`) e, quando o scanner o achou, `arquivo:linha`.

## O que o scanner não faz

Ele lê texto: não mede hit ratio, chave quente, chave grande, CROSSSLOT nem a política efetiva do servidor — isso é runtime (`INFO stats`, `redis-cli --hotkeys`, `--bigkeys`, `CONFIG GET`), documentado no catálogo e executado por quem tem acesso. `.set(` sem TTL na mesma linha pode ter `EXPIRE` na linha seguinte; `KEYS` num script de manutenção offline pode ser aceitável. O receptor de C-02 e C-09 é heurístico (`redis`, `cache`, `valkey`, `client`, `r`; no C-02 também Spring `opsForValue`, StackExchange `StringSet`/`HashSet` e go-redis `Set(ctx, …, 0)`). `bind` em todas as interfaces com `requirepass` ou ACL no mesmo arquivo é C-17 (`aviso`), não C-11. A maquinaria do harness (`.forge/agents`, `.forge/scripts`, `.forge/schemas`, `.forge/skills`, `.forge/rules` e afins) e os diretórios de adapter (`.claude` e `.agents`) ficam fora do universo, como os worktrees aninhados: numa instalação nova `--root .` só varre o projeto; `.forge/specs` e `.forge/product` entram. O scanner localiza; quem revisa decide.

## Referências

- `references/best-practices.md` — cache-aside, write-through, TTL, invalidação, stampede, chave quente, cache como fonte da verdade, memória e segurança, com fonte e marca de evidência.
- `references/antipatterns.md` — catálogo C-01 a C-17, T-01 e T-04.
- `scripts/scan.sh` — detecção estática de C-02, C-08, C-09, C-10, C-11, C-15, C-16 e C-17; contrato em `--help`.
