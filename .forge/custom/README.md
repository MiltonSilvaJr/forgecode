# custom/ — repo-local overrides (no fork)

Override any template-provided file by recreating its **relative path** under this directory
(pattern adopted from BMAD v6). Examples:

- `custom/rules/conventions/naming.md` overrides `.forge/rules/conventions/naming.md`
- `custom/templates/spec/requirements.md` overrides the spec template

Resolution order (intended): `custom/` first, then the installed template file.

> **Status (rc15):** a resolução automática por `custom/` **ainda não está implementada** —
> `sync-adapters`/`plugin-build` descobrem commands/agents/rules varrendo `.forge/` diretamente, sem
> empilhar `custom/`. Até isso existir, um override/adição autoral precisa viver em `.forge/` (ex.:
> `.forge/commands/meu.md`). O `forge update` **preserva** esses arquivos: a remoção de órfãos é
> curada por `installer/removed-files.txt` (só o que o template sabidamente renomeou/removeu), nunca
> "tudo que não está no template". Use `custom/` para guardar a intenção do override, mas saiba que
> ele não é resolvido em runtime hoje.

Rules:
1. Never edit installed template files in place — override here instead, so template upgrades
   stay mergeable.
2. `forge doctor` flags **orphan overrides** (override whose template counterpart no longer
   exists) as drift to clean up.
3. Overrides are committed — they are team policy for this repo.
