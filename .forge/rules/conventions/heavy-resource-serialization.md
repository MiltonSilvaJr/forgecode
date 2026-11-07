# Serialização de recurso pesado

O recurso escasso é a **máquina** — CPU e daemon Docker —, não a stack. Duas suítes pesadas na
mesma máquina não se somam: elas se atrapalham, e contaminam exatamente a medição de tempo e
memória que justifica rodá-las.

## O caminho do lock nunca vem de variável do chamador

`${TMPDIR:-/tmp}/<recurso>.lock` **não é um lock por máquina.** No macOS `TMPDIR` é por usuário e
por contexto de invocação: quatro valores distintos foram observados ativos na mesma máquina, e
com eles dois locks vivos simultâneos e um órfão de catorze horas que a detecção nunca alcançou —
porque ela estava olhando o outro arquivo.

O modo de falha é o pior possível: cada lado adquire com sucesso, roda, e **acredita estar
protegido**. Um lock particionado é pior que nenhum lock, porque parece um lock.

Use `lib/heavy-mutex.sh`. A âncora é resolvida por precedência fechada, e toda falha de uso do
caminho ancorado é falha dura com diagnóstico — nunca fallback silencioso para um caminho privado.

## Exclusão mútua não é justiça, e a falta de justiça não parece um defeito

`while ! mkdir "$lock"; do sleep N; done` garante exclusão e **não garante ordem nenhuma**. Quem
solta e retoma o lock já está a poucas instruções do `mkdir`; quem espera de fora dorme num
intervalo de polling. A janela livre é de microssegundos contra segundos de espera, então a chance
**não melhora com paciência**: é inanição, não lentidão.

A distinção importa porque muda o remédio. Aumentar o tempo de espera não corrige inanição; fila
com ordem de chegada corrige. E o sintoma se disfarça: exclusão mútua quebrada dá corrupção
visível, ausência de justiça dá espera — e espera se atribui a lentidão.

## Ordem das correções

Ancorar o caminho **antes** de enfileirar. Uma fila por `TMPDIR` é tão particionada quanto um lock
por `TMPDIR`, e o efeito seria duas filas justas disputando o mesmo Docker.

## Build local verde antes de entrar na fila

Medido: **1305 segundos de fila para descobrir um erro de sintaxe que aparece em 8 segundos.**
Quem entra na fila sem ter compilado ocupa o recurso para descobrir algo que descobriria sozinho.

O `pre-push` impõe isso por construção: os checks baratos rodam **antes** da aquisição, e só
`typecheck`, `test` e os gates ficam sob o lock.

## O diagnóstico nomeia o caminho, não só o dono

A mensagem de espera precisa dizer **onde** o lock está registrado, além de quem o detém e há
quanto tempo. Foi a ausência do caminho que escondeu a partição por catorze horas: duas mensagens
idênticas descreviam locks diferentes, e ninguém tinha como saber.
