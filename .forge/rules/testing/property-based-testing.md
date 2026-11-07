---
title: Property-Based Testing
applies_to:
  - all
priority: high
last_reviewed: 2026-07-29
---

# Property-Based Testing

Um teste por exemplo responde "com esta entrada, sai isto". Um teste de propriedade responde "para **qualquer** entrada válida, isto continua verdadeiro". Onde existe uma propriedade real, a segunda pergunta é a que importa — e é a que o autor do código não consegue responder de cabeça, porque ele escreveu o código pensando nos exemplos que imaginou.

O caso que motivou esta rule é concreto e recente: `mergeLogs` do liaison tinha doze asserções por exemplo, todas verdes, incluindo convergência com três participantes sob permutação de import. A primeira execução do teste de propriedade "mergeLogs é idempotente" encontrou um defeito em segundos — a mesma mensagem chegando por dois caminhos aparecia duas vezes na ordem da thread, e como a ordem é justamente o que as réplicas comparam para dizer que convergiram, duas réplicas idênticas pareceriam divergentes. Nenhum caso de exemplo pegaria: ninguém escreve à mão uma lista com a mesma mensagem repetida.

## Quando é obrigatório

Sempre que a unidade sob teste tiver uma **propriedade algébrica ou estrutural** verificável. As famílias que aparecem na prática:

| Família | Forma | Onde aparece |
|---|---|---|
| Invariância sob permutação | `f(xs) == f(shuffle(xs))` | merge de logs, agregações, ordenação total |
| Idempotência | `f(f(x)) == f(x)` | sync, import, normalização, saneamento |
| Round-trip | `decode(encode(x)) == x` | serialização, parsing, migração de schema |
| Comutatividade / associatividade | `f(a,b) == f(b,a)` | soma de valores, união de conjuntos |
| Invariante de conservação | `sum(split(v)) == v` | rateio de valores monetários, particionamento |
| Monotonicidade | `x ≤ y ⟹ f(x) ≤ f(y)` | relógios lógicos, contadores, versionamento |
| Preservação de conteúdo | `∀ p ∈ x: p ∈ f(x)` | sanitização que não pode apagar dado |

Se a unidade não tem propriedade — um adapter que só traduz DTO, um controller que só roteia — **não force**. PBT sobre código sem propriedade produz testes que reimplementam a função e não provam nada.

## Como escrever

1. **Enuncie a propriedade em uma frase**, antes de codificar. Se não sai em uma frase, provavelmente são duas propriedades.
2. **Gere entradas do domínio válido**, não de qualquer domínio: um gerador que produz estados impossíveis encontra "defeitos" que não existem, e o autor aprende a ignorar o teste.
3. **Fixe a seed.** Uma falha que não reproduz não é depurada — vira "roda de novo até passar", que é o oposto do que o teste existe para fazer.
4. **Exija shrinking.** Contraexemplo minimizado é a diferença entre um achado e um ruído: `[0,0,0]` aponta o defeito, `[8,3,91,7,42]` não.
5. **Verifique o embaralhador.** Uma propriedade de invariância sob permutação passa trivialmente se a permutação não permuta — a asserção sobre o gerador é parte do teste, não detalhe.

## Ferramentas

| Stack | Ferramenta |
|---|---|
| .NET | FsCheck |
| TypeScript / JavaScript | fast-check |
| Kotlin / Android | Kotest Property |
| Python | Hypothesis |
| Gates do próprio harness | `scripts/lib/pbt.mjs` (zero-dep) |

O harness traz `pbt.mjs` porque seus gates rodam com `node` puro sobre `template/.forge/**`, que é zero-dependência por contrato — as ferramentas acima vivem no projeto adotante. Uma norma de PBT que o próprio harness não consegue exercitar é uma norma que ninguém verifica. Ele oferece geração reprodutível por seed, busca de contraexemplo e shrinking; não pretende substituir fast-check num projeto que possa depender dele.

## Verificação

- Gate `w121` exercita o runner (propriedade falsa **precisa** falhar, contraexemplo **precisa** minimizar, seed **precisa** reproduzir) e as propriedades centrais do liaison.
- A cobertura de propriedades por change é declarada no `design.md` e conferida no `/forge:verify`.
- O que **não** existe ainda: um check determinista que reprove um change com propriedade declarada e sem teste correspondente. Enquanto não existir, esta parte é honor system — e está nomeada como tal aqui em vez de escondida.

Ver também [tdd](./tdd.md) e [change-test-contract](./change-test-contract.md).
