---
name: data-object-storage-practices
description: |
  Boas práticas e catálogo de antipatterns de object storage (S3, GCS, Azure Blob, MinIO) e das zonas de lake no nível de objeto, com varredura determinística em scripts/scan.sh: bucket ou objeto público, URL pré-assinada longa, SSE-KMS sem Bucket Key, imagem minio/minio comunitária arquivada, escrita destrutiva na zona raw/bronze e partição por coluna de alta cardinalidade. Use ao desenhar layout de chaves e prefixos, ciclo de vida, versionamento, WORM, criptografia, URL pré-assinada, entrega de arquivo a parceiro, bucket por zona do lake, ou quando o data-engineer delegar o domínio de objetos. Não use para formato, particionamento e manutenção de tabela silver/gold (data-analytical), para estado mutável compartilhado (banco), nem para dar a terceiro credencial ou policy sobre bucket interno (reprovado pela regra de integração).
---

# data-object-storage-practices

Referência do especialista `data-object-storage`. O conhecimento está em `references/` e foi julgado contra fonte primária (base consolidada do change `data-engineer-agent`, 2026-09-26); cada afirmação carrega a marca de evidência da base: [J] reconferido na fonte primária, [2F] duas fontes, [1F] documentação oficial do produto, [Interp.] interpretação técnica, [Heurística] limiar de partida.

## Escopo

Objetos imutáveis ou raramente reescritos: arquivo, mídia, backup, export, comprovante, zona bruta de lake. No medallion, este especialista responde pelo nível de objeto (bucket por zona, prefixos, ciclo de vida, criptografia, acesso público, WORM, small files); formato de tabela, particionamento de tabela, modelagem e manutenção são do `data-analytical`. Diretório estilo Hive (`dt=AAAA-MM-DD/`) é aceitável para arquivo bruto; tabela silver/gold segue a regra do analítico.

Entrega a terceiro (decisão H-02 (a) do dono, 2026-09-26): URL pré-assinada é entrega REST admitida somente com HTTPS, um único objeto nomeado, expiração em minutos, emissão por endpoint REST autenticado do produto que autentica o parceiro, log de emissão e bucket privado. Qualquer outra forma de acesso de terceiro a bucket — credencial IAM ou chave de acesso, policy ou ACL para o parceiro, bucket ou objeto público, URL de prefixo ou de vários objetos, URL de horas ou dias, URL emitida fora de endpoint autenticado ou sem log — é reprovada. Cliente próprio (app e web do produto) não é terceiro.

## Protocolo

Ordem fixa. É a ordem que torna a resposta auditável.

1. **Escopo.** Liste os paths afetados (IaC de bucket, código que gera URL ou escreve na lake, jobs de ingestão). Para cada bucket: classe de dado, retenção exigida, quem lê e por qual via.
2. **Rules do projeto.** Leia `.forge/rules/data/*`, `.forge/rules/architecture/internal-grpc-communication.md` e `.forge/rules/architecture/pii-pci-classification.md` quando ativa, os ADRs e o baseline. Divergência relevante para e vira `CONFLITO` (`.forge/rules/conventions/conflict-handling.md`).
3. **Detecção.** `bash .forge/scripts/check-data-governance.sh --path <path>` (interprete pela linha: `CONFLICT` é achado; `universo-vazio` e `node >= 20` são "não verificado") e `bash .forge/skills/data-object-storage-practices/scripts/scan.sh --root <path> [--root <path>...]`.
4. **Julgamento.** Cada `FOUND` é candidato; leia o trecho e decida com `references/antipatterns.md`. `ExpiresIn: 3600` para o app do próprio produto pode ser aceitável; para parceiro não é.
5. **Relatório.** Uma linha por regra, inclusive as limpas; todo antipattern apontado cita o id (`O-01`) e, quando o scanner o achou, `arquivo:linha`. WORM compliance só com obrigação legal registrada e conciliação LGPD.

## O que o scanner não faz

Ele lê texto: não vê multipart órfão, versões não correntes acumuladas, objeto pequeno transitando para classe fria, loop de evento nem small files — isso é runtime (`list-multipart-uploads`, S3 Inventory, Storage Lens) ou ferramenta (Checkov), documentado no catálogo. `overwrite` num job de silver é legítimo; o detector O-13 só olha a linha que cita `raw` ou `bronze`. Policy com `Principal "*"` em arquivo com `Condition` fica para a revisão, e `public_network_access_enabled` não é tratado como bucket público (é acesso de rede com credencial, não leitura anônima). A maquinaria do harness (`.forge/agents`, `.forge/scripts`, `.forge/schemas`, `.forge/skills`, `.forge/rules` e afins) e os diretórios de adapter (`.claude` e `.agents`) ficam fora do universo, como os worktrees aninhados: numa instalação nova `--root .` só varre o projeto; `.forge/specs` e `.forge/product` entram. O scanner localiza; quem revisa decide.

## Referências

- `references/best-practices.md` — layout de chaves, ciclo de vida, versionamento, criptografia, URL pré-assinada, bucket público, WORM, eventos e zonas de lake, com fonte e marca de evidência.
- `references/antipatterns.md` — catálogo O-01 a O-14 e T-03.
- `scripts/scan.sh` — detecção estática de O-01, O-02, O-08, O-11, O-13 e O-14; contrato em `--help`.
