# F1.66.6 — Equivalência de ordenação, HP e ações entre adapters

## Alterações

### Ordenação canônica

`MesaRepository.listCombatantsByCombat` agora usa explicitamente:

```text
sort_order ASC NULLS LAST, id ASC
```

O adapter Supabase usa dois `.order(...)`; o adapter PostgreSQL local usa o
mesmo `ORDER BY`. A ordenação estabiliza empates e não depende da ordem física
de leitura. Nenhuma seleção de personagem ou regra de turno foi alterada.

### HP

O contrato ganhou `updateCombatantHp`. `syncCombatHp` continua fazendo toda a
validação, clamp, cálculo de morte, autorização, tratamento de supplies e
decisão de no-op no domínio. O adapter apenas executa uma instrução `UPDATE`
condicional, sempre com `id`, `session_id` e `combat_id`; quando `hpBefore` é
fornecido, `hp_current` também entra no CAS.

O retry de coluna `supplies` ausente foi preservado no domínio. A telemetria
continua usando `DB_OP=atualizar o HP` e a mensagem de erro permanece a mesma.

### Débito de ações

O contrato ganhou `debitCombatantAction`. `performAction` e o débito legado de
`registerRoll` agora usam uma única operação condicional. O adapter não calcula
custo nem escolhe alvo: recebe o patch e os valores esperados já resolvidos.

As condições preservadas são:

```text
id + session_id + combat_id
actions_remaining = valor lido
movement_remaining = valor lido
is_dead = false
```

Quando não há exatamente uma linha afetada, o domínio continua retornando
`409 action_conflict`. Não há read-modify-write nem atualização parcial.

## Contratos reais

A suíte compartilhada foi ampliada com:

- ordenação canônica (`sort_order`, `id`) após inserção física invertida;
- HP válido, conflito CAS, escopo incorreto e verificação de ausência de
  alteração parcial;
- duas escritas concorrentes de ação, comprovando exatamente um sucesso e um
  conflito (`[0, 1]` linhas retornadas), com valores finais persistidos;
- mapeamento fake separado para ordenação, HP e ações.

Resultados dos contratos:

| Alvo | Resultado |
| --- | ---: |
| PostgreSQL local real, 28 migrations | **11/11** |
| Supabase remoto real via PostgREST | **11/11** |
| Fake/mapeamento | **7/7** |

Os testes locais e remotos usam fixtures descartáveis e a limpeza confirma
ausência de resíduos. Nenhum dado real é usado como fixture.

## Acoplamentos restantes

- `ResolutionStore` local e RPCs de resolução;
- transporte local de invalidações;
- outras mutações de HP/ações especiais (movimento, netrunner, resoluções
  atômicas) — movimento agora possui um slice atômico em F1.66.7, mas as
  demais resoluções continuam no store;
- seleção explícita de hospedagem, WebSockets locais e integração das rotas
  com PostgreSQL local continuam fora desta etapa.

O modo local integrado ainda não está pronto.

## Validação final

| Verificação | Resultado |
| --- | --- |
| Suíte completa com PostgreSQL local | **1048/1048 aprovados, 0 falhas, 0 skips** |
| Suíte completa sem `MESA_LOCAL_TEST_DATABASE_URL` | **1037 aprovados, 0 falhas, 11 skips** (somente contrato local) |
| Lote direcionado (HP, ações, combate, autorização e contratos) | **54/54 aprovados** |
| `npx tsc --noEmit` | passou |
| `npm run build` | passou |
| `git diff --check` | passou |
| `npm run lint` | baseline **34 erros / 82 avisos**; nenhum erro novo nos arquivos desta etapa |

Nenhum commit foi criado.
