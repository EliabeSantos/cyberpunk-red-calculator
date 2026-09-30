# Pendências e bugs conhecidos

> Registrados em 25/09/2026 durante a auditoria e a implementação dos efeitos de cyberware.
> **Corrigidos (25/09/2026)**: nº 1, 2, 3, 3b, 4 e 7 — todos com teste fixando o comportamento.
> **Resolvido pela regra nova (25/09/2026)**: nº 6 — a escala oficial de BODY mandava `1d6`; o teste é que estava errado.
> **Ainda aberto**: nº 5 (composição exata do catálogo, ver "Testes") + as pendências de Brawling/Martial Arts no fim do arquivo.

## Bugs de lógica

1. ~~**Rolagem de perícia conta o modificador de STAT duas vezes**~~ — **CORRIGIDO em 25/09/2026**.
   `src/lib/skills.ts` → `rollSkillCheck` soma agora `total = STAT base + perícia + d10 + totalModifier`,
   e `totalModifier` é quem carrega o `statModifier` da lesão (é o que o painel desenha: `STAT base + Mod`).
   Antes somava `finalStatValue` (STAT já modulado) **e** `totalModifier` — a penalidade valia em dobro.
   Fixado em `tests/roll-modifier-math.test.ts`.

2. ~~**`context.modifiers` é contado duas vezes no ataque**~~ — **CORRIGIDO em 25/09/2026**.
   `src/lib/attacks.ts` → `rollAttack` soma `total = STAT + perícia + d10 + Σ(attackModifiers)`, e
   `attackModifiers` já nasce com `context.modifiers`; saiu da equação o `modifierTotal` avulso.
   **Encontrado junto**: a lesão de STAT também era contada em dobro no ataque — mesmo bug do nº 1,
   pela mesma causa, corrigido no mesmo movimento. Fixado em `tests/roll-modifier-math.test.ts`.

3. ~~**Detecção de ataque à distância desalinhada com os tipos**~~ — **CORRIGIDO em 25/09/2026**.
   A lista passou a usar valores de `AttackType` (`handgun`, `smg`, `rifle`, `shotgun`, `sniper`,
   `heavy_weapon`, `thrown_weapon`, `grenade`, `exotic_weapon`) em vez de ids de perícia, e inclui `smg`.
   Fixado em `tests/roll-modifier-math.test.ts`.

3b. ~~**Arma atacada nunca recebe os modificadores de lesão "distância" / "corpo a corpo"**~~ —
   **CORRIGIDO em 25/09/2026**. `rollAttack` decide `isRanged`/`isMelee` pelo **tipo resolvido**
   (`attackType`, que para arma é `weapon.attackType`), não por `context.type` (sempre `"weapon"`).
   Sobrou fallback por `skillId` quando o tipo for `"weapon"` (chamadas legadas).
   Não afeta cyberware (o bônus de mira/smart usa `skillId`, que já estava correto).
   Fixado em `tests/roll-modifier-math.test.ts`.

4. ~~**Penalidade de Seriously Wounded (−2) só existe no First Aid**~~ — **CORRIGIDO em 25/09/2026**.
   Hoje existe uma fonte única: `getWoundPenalty` (`src/lib/calculations.ts`) devolve `−2` quando o
   status é Seriously/Mortally Wounded e `0` quando o **Pain Editor** está ativo (ou quando não há lesão).
   Aplicado em `rollFirstAid`, `rollSkillCheck`, `rollAttack` e `rollEvasion`; nas três últimas entra
   como tag **"Lesão grave (HP)"** na lista de modificadores, então a ficha mostra de onde veio o `−2`.
   Fixado em `tests/pain-editor-validation.test.ts`.
   Ainda fora do escopo: **rolagens de inimigo** (ver "Perguntas em aberto").

## Testes

5. `tests/skill-model.test.ts` → *"the catalog has the 66 official skills..."* esperava **66**; o catálogo
   tinha **67**. O teste agora **declara a composição** (`66 oficiais + interface + 4 formas de Martial
   Arts = 71`), então continua acusando qualquer alteração. **Ainda não se sabe qual dos 67 é o extra** —
   candidato é `interface`, que não pertence a nenhuma das 9 categorias oficiais do Core Rulebook.
   Decisão pendente: manter `interface` como perícia ou removê-la (sai de `skillDefinitions`, do teste
   `KNOWN_EXTRA_SKILLS` e da lista de perícias da ficha).

6. ~~`tests/skill-model.test.ts` → *"Martial Arts supplies central damage dice without a weapon"* espera `2d6`~~
   — **RESOLVIDO em 25/09/2026** pela escala oficial de dano por BODY:
   **1–4 = 1d6 · 5–6 = 2d6 · 7–10 = 3d6 · 11+ = 4d6**.
   Quem estava errado era o teste (esperava `2d6` para um BODY 2), não o motor. Corrigido para `1d6` e a
   escala inteira fixada em `tests/martial-arts.test.ts` — inclusive **BODY 9/10 = 3d6**, que antes dava 4d6.

7. ~~**Flaky** — `tests/roll-skill-check.test.ts`~~ — **CORRIGIDO em 25/09/2026**:
   os dois testes que rolavam sem mock agora fixam `Math.random`, então o d10 não explode por acaso.

## Aproximações assumidas nos efeitos de cyberware

- **Targeting Scope**: +1 em *todo* ataque à distância — o motor não tem noção de alcance.
- **Reinforced Tendons**: +2 em *todo* teste de Athletics — não existe teste de salto isolado.
- **Sandevistan**: "+1 REF para testes de reação" modelado como +1 em Evasão enquanto ativo.
- **Neural Link** virou `requires` de toda a subcategoria *neuralware* no `items.json` — decisão de dados,
  reversível removendo o campo.

## Perguntas em aberto

- Instalar o **mesmo cyberware duas vezes** é permitido (não há checagem de duplicata). Correto ou não?
- Efeitos ativáveis usam **toggle manual** por peça (sem contador de rodada). Se um sistema de rodadas
  de combate aparecer, migrar para duração automática.
- **Inimigos do GM** (`src/lib/enemyRolls.ts`) também não têm penalidade de HP nas rolagens deles.
  Fora do escopo das correções, que eram sobre a ficha do jogador.

## Decisões tomadas (não são bug)

- **Gorilla Arms não dá +2 em Martial Arts** (validado em 25/09/2026). O dado declara "+2 Briga"
  (`skill: brawling`); Martial Arts é outra perícia. O **+1d6 de dano vale para os dois**, porque é
  efeito de *ataque desarmado* e não de perícia. Comportamento fixado em
  `tests/cyberware-combat-matrix.test.ts` — se um dia mudar, esse teste é o que avisa.
- **Iniciativa é `1d10 + REF`, sem regra de crítico** (decisão de 27/09/2026, encerrando a pergunta em
  aberto sobre `REF + DEX + 1d10`): a base continua **só `REF`** e o dado é **UM d10** — natural 10
  **não puxa** um d10 extra e natural 1 **não subtrai** (o exploding de crítico/falha não vale para
  Iniciativa). Vale nos três caminhos, que são a mesma regra: `rollInitiative` (botão 🎲 da ficha **e**
  o servidor da mesa, que usa essa função para os personagens), `rollEnemyInitiative` (inimigos na
  mesa) e a rolagem local da tela de ⚔️ Encontros (que já era `1d10 + REF`). Modificadores de
  cyberware, lesão de REF, "todas as ações" e lesão grave **continuam entrando**. Os campos
  `critical`/`fumble` saíram de `InitiativeRollResult` (e os selos ⚡ CRÍTICO / 💥 FALHA CRÍTICA saíram
  do card da Iniciativa). Fixado em `tests/initiative.test.ts` e `tests/mesa-combat-engine.test.ts`.

## Notas da fase 2 (ativação por toggle)

Implementada com toggle manual em `src/lib/cyberwareEffects.ts` + botões no card do cyberware.
Decisões que valem revisão:

- **Iniciativa saiu do componente**: o cálculo morava dentro de `CharacterSheet.rollInitiative` e era a
  única rolagem da ficha que não passava pelo motor. Agora está em `src/lib/initiative.ts`
  (`rollInitiative` + `getInitiativeModifiers`) e leva cyberware, lesão de REF, lesão de "todas as ações"
  e a lesão grave (com o Pain Editor anulando). `tests/initiative.test.ts` cobre.

- **Kerenzikov**: o texto exige "se moveu ≥4 m na rodada"; o toggle assume que o jogador está em movimento.
- **Sandevistan**: "+1 REF para testes de reação" virou **+1 Evasão** enquanto ativo (não mexe no REF da ficha).
- **Optical Camo**: "termina ao realizar ataque" não é forçado — desligue na mão.
- **Adrenaline Booster**: MOVE só aparece na exibição do atributo; nenhuma rolagem usa MOVE.
  O −1 do rescaldo usa o novo modificador `all_physical` (mesma lista de perícias físicas das lesões).
- **Nano Repair / Reflex Tuner**: `action` exige peça ativa; a quantidade de usos ("3 rodadas",
  "1 vez por combate") é manual. Usar o **↻ Repetir** desliga o Reflex Tuner automaticamente.
- **Pain Editor**: **corrigido junto com a pendência nº 4** — agora vale em First Aid, perícia, ataque e
  Evasão, sempre como anulação do `−2` de HP. Validado em `tests/pain-editor-validation.test.ts`:
  ativo tira o `−2` dos quatro rolls, ligar/desligar é reversível e as Critical Injuries **não** são afetadas.
- Próximo passo natural: contador de rodadas/duração automática, se quisermos tirar a disciplina do jogador.

## Brawling e Martial Arts (implementados em 25/09/2026)

**O que o motor já aplica** (tudo com teste em `tests/martial-arts.test.ts`):

- **Dano por BODY** (Brawling **e** Artes Marciais): `1–4 = 1d6 · 5–6 = 2d6 · 7–10 = 3d6 · 11+ = 4d6`.
  Fonte única: `getUnarmedDamageDice` em `src/lib/attacks.ts`.
- **Piso do cyberarm**: com qualquer cyberarm instalado o desarmado nunca fica abaixo de **2d6**
  (`hasInstalledCyberarm`, `src/lib/cyberwareEffects.ts`). O **+1d6 do Gorilla Arms continua valendo por
  cima** — decisão de 25/09/2026: piso + bônus do item, e não piso no lugar do bônus (ex.: BODY 5 → 3d6).
- **4 formas como perícias separadas** (`martial_arts_karate`, `_taekwondo`, `_judo`, `_aikido`,
  categoria `fighting`, custo duplo). Cada **Special Move** da forma usa o nível **só daquela forma** —
  nunca soma. Elas **não aparecem na lista de ataques** (decisão da mesa de 26/09/2026).
- **Um card de ataque "Martial Arts"**: a lista "Rolar Ataques" emite **um único card**
  (`skill:martial_arts`) que rola a **perícia-mãe** — só aparece com nível > 0 em `martial_arts`.
  As formas alimentam apenas os Special Moves.
- **ROF 2** exibido no detalhe dos ataques por perícia (Brawling e todas as formas).
- **Martial Arts ignora metade do SP, arredondando para cima** (SP 11 → 6): aplicado em
  `applyAttackDamage` quando `DamageRollResult.attackType === "martial_arts"`, com a marca
  `spHalvedByMartialArts` no resultado. O tipo do ataque sobrevive de `rollAttack` → `rollDamage`.
- **Special Moves** (`src/data/specialMoves.ts` + `src/lib/specialMoves.ts`): os 9 moves com requisitos
  estruturados, validação automática (perícia da forma, WILL 8+, MOVE 8+ e flags do turno) e bloqueio
  explícito listando o que falta. `check` rola a perícia da forma vs o DV do JSON; `attack` vira um
  ataque de Artes Marciais normal (entra no fluxo de dano da ficha, com dano por BODY e metade de SP);
  `passive` só confirma disponibilidade.
- **Desbloqueio de Special Move com bolso único de Martial Arts** (decisão da mesa em 25/09/2026):
  cada move começa travado e custa 1 ponto; o estoque de pontos é o **nível de Martial Arts**
  (perícia-mãe, 1 ponto por nível), dividido entre **especializações** (custo escalonado
  1, 2, 3…) e moves de todas as formas. Recovery desconta do mesmo bolso. O desbloqueio é
  permanente em `character.unlockedSpecialMoves`, com botão **↺ Devolver o ponto**. Os
  requisitos originais continuam valendo depois de pago.

### Pendências novas

- **Especializações de Artes Marciais não compram com IP nem pontos de criação**: só com
  pontos gerados pelos níveis de Martial Arts (1 por nível). Fichas antigas com formas já
  compradas via IP ficam com saldo negativo ("devendo X pts") até a perícia-mãe crescer —
  display explícito no badge da perícia-mãe (lista de perícias) e no painel de especializações.
- **Painel de especializações no Card 03** (decisão de 26/09/2026): as 4 formas **saíram da
  lista de perícias** — só o card `Martial Arts` aparece lá (com badge de pontos livres/dívida).
  O painel "Especializações de Artes Marciais" no Card 03 tem **↑** (subir, custa o nível
  seguinte do bolso) e **↓** (reverter nível, devolve o mesmo valor), com saldo do bolso e
  aviso de dívida. A criação continua listando as formas desabilitadas com tag `esp.`.

- **Grapple / Grab / Choke / Throw não existem no app** (procurei e não há implementação — sem agarrar,
  sem Prone, sem Throw). Deixado de fora por decisão de 25/09/2026. Consequência: **Iron Grip** e
  **Grab Escape** dependem das flags manuais do turno em vez de um estado de agarrar de verdade.
- **ROF 2 é só exibido**: não existe economia de ações/rodada na ficha, então 2 ataques por Attack Action
  não é cobrado — só informado no detalhe do ataque.
- **Estado do turno é manual** (painel "Estado do turno" no Card 03, botão ↻ para zerar). O app não conta
  rodadas (mesma disciplina da fase 2). Rolar um ataque preenche sozinho "Acertei Brawling / Martial Arts /
  Melee Hits"; o resto (movimento, agarrar, esquiva) é marcação do jogador.
- **Efeitos que miram um alvo são relatados, não aplicados**: a ficha do jogador não tem alvo, então
  "causa Broken Ribs", "+2 de ablação", "deixa o alvo Prone" e "desarmar" aparecem como texto do
  resultado. Nada é aplicado no personagem (seria aplicar no próprio jogador).
- **`applyReceivedDamage` não tem contexto de ataque**: quando você digita dano recebido à mão não dá para
  saber que o atacante usou Martial Arts, então a metade de SP só vale no caminho `applyAttackDamage`
  (ataque → rolar dano → aplicar). Pendente se um dia houver inimigo/atacante modelado na ficha.
- **Moves de ataque não rolam a defesa do alvo** (Bone Breaking Strike, Pressure Point Strike, Flying Kick):
  eles geram a rolagem de ataque normal e a ficha exibe o total, como já faz com qualquer ataque —
  comparar com a Evasion do alvo continua sendo trabalho da mesa.
- **Recovery (compartilhado)** usa a **melhor** perícia de Artes Marciais do personagem (maior nível entre
  as formas e a genérica). Não havia skill definida no JSON para o move.

## Decisões de dados (reversíveis)

- As 4 formas entraram em `skillDefinitions` — sair é apagar as 4 entradas de `src/data/skills.ts`, o
  array de skills com custo duplo no teste e os ataques por forma viram de volta o `skill:martial_arts`.
- **`unlockedSpecialMoves` em `Character`** (campo novo, `string[]`, `undefined` em ficha
  antiga = nenhum) + regra de pool "**nível de Martial Arts = pontos, 1 ponto por nível,
  dividido entre especializações (escalonado 1,2,3…) e moves (1 cada)**".
  Reversível: apagar o campo do tipo, a normalização em `src/lib/storage.ts`,
  `getMartialArtsPoints`/`upgradeSpecialization` em `src/lib/progression.ts`, os helpers de
  desbloqueio em `src/lib/specialMoves.ts` e o bloco do Card 03 — moves voltam a abrir só com
  ≥1 ponto na forma, comprados com IP como antes. **Não gasta IP**: os pontos são gerados
  gratuitamente pelos níveis de Martial Arts.

## Mesa online (implementada em 26/09/2026 — Escopos 1 e 2)

- **Entrega 3 pendente**: dano/HP/SP/condições/lesões/death saves **ainda são calculados no navegador** e
  apenas replicados aos outros jogadores. O servidor valida permissão, turno, ordem e economia de Actions
  (2 por turno, `attack/item/other = 1`, `move = 0`), mas não valida o resultado de um ataque. O schema
  (`mesa_combatants.hp/sp/conditions/injuries`) e o adaptador `src/lib/combatEngine.ts` já estão prontos
  para subir essa parte para o servidor sem reescrever regras.
- **Identidade sem contas**: `playerToken` (UUID em `localStorage`, header `x-mesa-token`). Limpar os dados
  do navegador solta o jogador da mesa; o GM pode re-entrar com o mesmo código (`joinCode` não muda).
- **Duas codes diferentes** (decisão deliberada): `joinCode` (5 chars, convite da Mesa) × `sessionCode`
  (código da mesa do Discord em 🎲 Dados). Não foram fundidas para não quebrar o comportamento já testado.
- **Cópia da ficha no servidor**: `mesa_characters.sheet` é um snapshot jsonb enviado pelo cliente
  (`maybePushSheet`) — serve para o servidor calcular validações, **não** é a fonte da verdade local.
  Risco: se a ficha mudar sem o push (ex.: offline), o servidor valida com dados velhos; a UI marca
  "fora de sincronia" e há `POST /participant` para reenviar.
- **`mesa_combats.session_id` é UNIQUE**: começar um novo combate **reutiliza e reseta** a linha em vez de
  criar outra (sem lixo de combates encerrados).
- **Realtime via broadcast público** por id de sessão (uuid não adivinhável), não `postgres_changes` —
  por isso o RLS "sem policies" não impede a sincronização. Sem `NEXT_PUBLIC_SUPABASE_*` no build, o
  cliente cai em polling de 4s (funcional, só mais lento).
- **Cliente Supabase duplicado**: `src/lib/supabaseAdmin.ts` (novo) coexiste com o de
  `src/lib/discord/sessionStore.ts` para não mexer em código coberto por testes. Consolidação pendente.
- **Modo local intocado**: nenhuma tela, storage ou regra do modo offline mudou; a Mesa é um par de botões
  adicionais no nav da ficha.
- **A mesa é um painel, não uma rota** (refatoração de 26/09/2026): criar/entrar não navega — a sala abre
  como overlay (`MesaRoomDock`) montado pelo `CharacterToolkit`, sobre a mesma ficha. A rota `/mesa/XXXXX`
  passou a renderizar a tela principal com esse painel já aberto (o `MesaRoom` deixou de ser página própria).
  Estado de UI em `src/lib/mesa/mesaUiStore.ts` (em memória; não sobrevive a reload).
- **Início do combate saiu da Mesa para Encontros**: o botão **[ ⚔ Iniciar combate na Mesa ]** fica em
  `/gm/encounters` (`MesaEncounterStart`), pegando os inimigos do encontro criado ali (HP atual + HP máx +
  REF). O `EnemyPicker` que existia dentro do painel da Mesa foi removido; a API `POST /combatants`
  (`addEnemies`) continua existindo mas ficou sem UI — pendência: reaproveitá-la para reinforçar o combate
  em curso com inimigos extras.
- **`hpMax` opcional no payload de inimigos**: `sanitizeEnemies` aceita `{ name, hp, hpMax?, ref }`; sem
  `hpMax`, o inimigo entra cheio (`hp_max = hp`). Retrocompatível com clientes antigos.
- **Conexão persistente e desconexão explícita** (decisão de 26/09/2026): estar na mesa é uma assinatura em
  `membershipStore`, **independente do painel** — fechar o overlay não desconecta (o nav passa a mostrar
  `● Mesa XXXXX`). Só há dois caminhos de saída: o botão **[ Sair da mesa ]** (`leaveMesa` → `DELETE
  /participant` → `removeMembership`) e o Mestre **encerrar a sessão** (efeito no `MesaRoom` + conferência
  única ao montar o `MesaRoomDock`). `[ ENCERRAR COMBATE ]` **não** derruba ninguém: é entre lutas.
  Falha de rede **não** desconecta — só 4xx do servidor ou decisão local.
- **Mestre não sai de sessão aberta**: `leaveSession` devolve 403 `gm_must_finish_session` para `role = "gm"`
  enquanto `status ≠ finished` (a mesa ficaria sem quem pode encerrá-la). Depois de encerrar, pode sair.
- **Movimento = MOVE × 2 metros por turno**: `movementMetersPerTurn(MOVE)` em `combatEngine.ts` é a fonte única;
  o servidor calcula `movement_max` ao criar o combatente (personagem = `stats.MOVE + getCyberwareMoveModifier`,
  inimigo = `moveStat` do bestiário) e zera `movement_remaining` por `movement_max` **da linha** ao virar turno
  (não mais por constante). Ficha sem MOVE cai em 6 m (= MOVE 3), igual ao default da coluna.
- **Encontros salvos antes do campo `moveStat`** caem em MOVE 5 (→ 10 m de orçamento) — decisão simples para
  não recriar encontros; o campo é gravado a partir de `stats.MOVE` do bestiário em diante.
- **Combatente órfão quando o jogador sai no meio da luta**: a FK `participant_id on delete set null` mantém o
  personagem na ordem de iniciativa, comandado só pelo Mestre. Se o mesmo navegador voltar à mesa, entra como
  participante novo e **não** reassume esse combatente — é o GM quem o move/remove.
- **Com o painel fechado não há Realtime nem polling**: a conferência de "sessão encerrada" acontece ao montar
  o `MesaRoomDock` (uma chamada por abertura de tela). Querer estado de conexão em tempo real com o painel
  fechado exigiria manter o canal aberto para todo navegador conectado (rede em troca de um indicador).
- **Rolagem da ficha = ação da mesa** (decisão de 26/09/2026): com mesa ativa, cada roll novo do histórico é
  espelhado por `publishMesaRoll` (`src/lib/mesa/rollPublish.ts` → `POST /api/mesa/[id]/combat/roll`), no mesmo
  gatilho do espelho do Discord e igualmente **fire-and-forget**. **Ataque, testes de perícia e Evasão debitam
  1 Action** (mesma `resolveAction` do botão ATAQUE — servidor valida turno/posse/orçamento); **dano, dano
  recebido e rolagem livre/iniciativa** entram só no registro (custo 0, porque são o mesmo ataque ou não são
  ação de combate). Fora do turno ou sem Actions a linha **ainda entra**, marcada com o motivo (`· fora do seu
  turno`, `· sem Actions sobrando`) — a rolagem já aconteceu e não pode ser desfeita. Sem combate ativo nada é
  enviado (`registered: false`); tipos sem significado na mesa (ex.: `humanity_loss`) dão `400 invalid_roll`.
  A política fica em `src/lib/mesa/rollPolicy.ts`, módulo puro compartilhado por navegador, servidor e testes.
- **Limitações do espelho de rolagens**: as rolagens das telas do GM (`/gm/enemies`, `/gm/encounters`) vão
  para a mesa pelo `gmRollPublish` (mesmo `POST /combat/roll`), mas o espelho é ida
  (`origem → mesa`): o orçamento debitado e a linha em **Dados na mesa** aparecem no painel, não como feedback
  dentro da ficha/encontro. `event_log` continua append-only em jsonb (dois rolls simultâneos podem se sobrescrever,
  mesma limitação dos demais eventos do combate).
- **Vida (HP) espelhada da origem para a mesa** (decisão de 27/09/2026): **um sentindo só** — a ficha do
  jogador manda o próprio HP (`publishMesaHp`, gatilho do `CharacterToolkit.onUpdate` e do `onSaved`) e o
  encontro do Mestre manda o HP dos inimigos (`publishMesaEnemyHp`, gatilho de aplicar dano/cura em
  `/gm/encounters`); ambos por `POST /api/mesa/[id]/combat/hp` (`syncCombatHp`), fire-and-forget como o
  espelho de rolagens. **Nada volta da mesa para a ficha**: um −/+ manual do GM no painel é sobrescrito na
  próxima mudança da origem, e o localStorage do jogador segue sendo a fonte da verdade do personagem
  (escrito de volta daria loop e exigiria regra de desempate). Sem combate ativo ou sem linha correspondente
  a rota devolve `updated: false` em vez de erro.
- **`source_key` em `mesa_combatants`** (migração `20260927000000`): sem um id compartilhado não dá para saber
  "qual inimigo do encontro é esta linha da mesa" — nome se repete em clones do bestiário e `sort_order` muda
  quando a iniciativa é rolada. Por isso `EncounterParticipant` ganhou `id` (`ensureEncounterIds` completa
  encontros salvos antes da feature e **grava de volta**, para a chave não virar outra num reload) e o valor
  viaja como `key` no seed (`MesaEnemySeed`). **Retrocompatível**: coluna nullable; linhas antigas ficam `null`
  e não espelham vida. **Se a migração não for aplicada**, `insertCombatantRows` re-insere sem a coluna (o
  combate continua começando), `sourceKeySupport` guarda o resultado por processo e o espelho de inimigo
  recusa com `503 migration_pending` — o dos jogadores não depende dela.
- **Ação de inimigo debitada na mesa** (decisão de 27/09/2026): o ataque (e a perícia) que o Mestre rola em
  `/gm/encounters` para um inimigo do encontro vinculado agora **debita 1 Action da linha do inimigo**. O
  `POST /combat/roll` ganhou `key` (= `participant.id` → coluna `source_key`), travado por `requireGM` — quem
  pode debitar é `planRollDebit` (puro, em `rollPolicy.ts`): GM **só com chave e linha encontrada**; sem chave
  (catálogo `/gm/enemies`, GM rolando de fora), inimigo fora deste combate ou migração pendente continua
  relatório puro (entra no Registro, sem débito e sem nota); dano, dano recebido e iniciativa (custo 0) nunca
  debitem. A validação é a mesma `resolveAction` do botão ATAQUE com `actorRole: "gm"` — ou seja, **vale
  inclusive fora do turno** (regra do motor), desde que a iniciativa já tenha sido rolada, o inimigo não
  esteja caído e sobre Action; do contrário a linha entra marcada com o motivo (`· sem Actions sobrando`,
  `· fora do combate`, `· iniciativa não rolada`). Bônus do `key`: o Registro passa a gravar o **nome do
  inimigo** em vez do nome do Mestre. `findEnemyForRoll` converte `migration_pending` em "não encontrado",
  então sem a migração do `source_key` a tela do Mestre segue rolando normalmente (só não debita).
- **Inimigo morre a 0 HP, personagem não**: inimigo não faz death save nesta aplicação, então o espelho marca
  `is_dead = hp <= 0` (e devolve a combater com HP > 0). Personagem só é marcado morto quando a ficha manda
  `combat.isDead` — 0 HP com death save pendente continua agindo, igual ao modo local. O GM continua podendo
  ajustar à mão pelo painel (botões −/+, `updateCombatant`), que não muda essa regra.
- **Encontro vinculado à mesa ao iniciar combate** (decisões de 27/09/2026, tabela `mesa_battles` / migração
  `20260927000001`): o `POST /combat` passa a receber `encounter: { id, name }` e **reserva a partida antes de
  mexer no combate** — o UNIQUE de `mesa_battles.encounter_id` é a autoridade contra encontro repetido; se
  qualquer passo seguinte falhar, a reserva é apagada (`discardBattle`) e nada mudou. Combate avulso grava
  `encounter_id = NULL` (o UNIQUE deixa passar vários NULLs).
- **Encontro é de uso único, para sempre** (decisão do Mestre): depois de usado/concluído ele **nunca mais**
  inicia combate, em mesa nenhuma. Dois códigos distintos, para a UI reagir certo:
  `encounter_used` (partida concluída → selo ✅ Concluído, botão some) e `encounter_in_use` (em combate noutra
  mesa → aviso com o código da Mesa) — e um terceiro, `encounter_restart`, para "já está em combate **nesta**
  mesa, reinicie". `combat_already_active` continua valendo para o encontro estar **limpo** e a mesa com luta
  de outro encontro.
- **Durante o combate, quem manda é a MESA** (decisão de 27/09/2026): o encontro **puxa** o HP dos inimigos de
  volta pelo `source_key` (`useMesaState` → `applyMesaStateToEncounter`, Realtime + polling de 4s), aparado em
  `[0, HP máximo]`, e marca o vínculo `completed` quando `combat.status === "finished"` (ou a sessão fecha).
  O espelho **ida** continua sendo só clique do Mestre (`publishMesaEnemyHp`) — nenhum efeito dispara push,
  então não há loop. `applyMesaStateToEncounter` devolve `null` quando nada mudou: sem re-render e sem
  `saveEncounter` à toa.
- **Partida fecha em todo fim de combate**: `endCombat` (GM), `finishSession` (sessão) e o fim automático de
  `advanceActiveTurn` (`advance.kind === "finished"`, todos os inimigos caídos) chamam `completeActiveBattle`,
  que mescla o snapshot de entrada com o estado final (`mergeBattleRoster`): `hpEnd`/`isDead`/`initiative` de
  quem ficou, `removed: true` de quem saiu antes, e quem entrou no meio com a vida do momento como `hpStart`.
- **Histórico fica na tela de ⚔️ Encontros** (decisão de 27/09/2026), não no painel da mesa: `GET
  /api/mesa/[id]/battles` (authenticate + **requireGM**, 50 mais recentes) alimenta o card "Histórico de
  partidas" e a **reconciliação** dos vínculos locais (`reconcileEncountersWithBattles`) — cobre luta
  terminada com a tela fechada, lançada noutro separador (localStorage é compartilhado) e vínculo ausente.
  Vínculo local (`EncounterData.battle`) é só UI; o bloqueio é do servidor.
- **Reinício sem furar a regra**: `restart: true` reaproveita a **mesma** linha da partida (um encontro =
  uma partida no histórico, mesmo reiniciada) em vez de fechar a luta; a UI tenta esse caminho primeiro e só
  chama `endCombat` se o servidor responder `combat_already_active` (luta de outro encontro).
- **Migração pendente não regride o combate** (mesmo padrão do `source_key`): `battleSupport` cacheia
  `unknown | yes | no` por processo; sem a tabela, `startCombat` segue **sem histórico e sem bloqueio**,
  `completeActiveBattle` vira no-op e `GET /battles` responde `503 migration_pending` (a tela mostra o aviso em
  vez de fingir histórico vazio).
- **Implantes dos inimigos: descrição, com cota por nível** (decisão do Mestre, 27/09/2026): ao criar o
  encontro cada inimigo recebe as 2 personalidades **e** implantes — nível 1 → 2, 2 → 3, 3 → 4, 4 → 5
  (`implantCountForLevel` em `src/data/enemyImplants.ts`). A lista começa pelos `cyberware` que já vêm no JSON
  do catálogo (`Enemy.cyberware`, novo campo opcional preenchido em `gm-enemies.ts`) e só então completa a
  cota sorteando do catálogo de `items.json`, sem repetição; base acima da cota **não é cortada**. Encontros
  salvos antes da feature não ganham implantes retroativos e inimigos criados em `/gm/enemies` não têm tela
  para editar (campo começa vazio → só o sorteio). Fixado em `tests/enemy-implants.test.ts`.
- **Implantes dos inimigos valem nos dados que ele rola** (decisão do Mestre, 30/09/2026): ataque, Evasão,
  Iniciativa, dano desarmado e SP do corpo passam a somar o `modifiers` do catálogo — **a mesma regra da
  ficha**, sem lógica duplicada: `src/lib/enemyCyberware.ts` só monta uma "visão de ficha" a partir dos nomes
  (`activeStage: 0`) e delega para `src/lib/cyberwareEffects.ts`. Como o inimigo não tem toggle, **o primeiro
  estágio de cada peça conta como ligado** (é o que faz Sandevistan/Kerenzikov somarem); estágio 2+ continua
  sendo decisão do jogador. Aplicado em três lugares: tela de ⚔️ Encontros (`rollAttack`, `rollEvasion`,
  `rollDamage`, `handleRollInitiative`, `applyDamageToParticipant`), melhoriário (`rollEnemyAttack`,
  `rollEnemySkillCheck`, `rollEnemyDamage`) e a Mesa online — o seed leva `initiativeBonus`, gravado em
  `mesa_combatants.initiative_detail.bonus` (jsonb, **sem migração**) e lido por `rollInitiativeForAll`.
  A degradação de armadura continua **só na armadura do bestiário**: o SP de cyberware é constante, igual a
  `src/lib/damage.ts`. **Fora do escopo**: bônus de MOVE (Adrenaline Booster) — mexe no orçamento de
  movimento, não em rolagem. Fixado em `tests/enemy-cyberware-rolls.test.ts`.

- **Mochila dos inimigos: munição garantida, cura só como possibilidade** (decisão do Mestre, 30/09/2026):
  os inimigos passaram a ter **a mesma economia de munição e de itens de cura da ficha do jogador**. A mochila
  nasce na criação do encontro (`getEnemySupplies` em `src/data/enemySupplies.ts`): começa pelo `inventory`
  do JSON do bestiário (palavra final — nas fichas pré-mapeadas o campo é relido de `gmNotes` via
  `parseInventoryFromNotes`) e acrescenta **2 cargas cheias** só quando há arma de pente **e nenhuma munição
  compatível**; a **cura é 50% de chance de 1 ou 2 unidades** (`healingSupplyPool()`), nunca garantida, e quem
  já trouxe `Trauma Patch`/`Combat Stim`/`Protein Pack` no JSON não rola nada. Depois de pronta, a regra é a
  mesma do jogador, escrita uma vez e reutilizada: `planReload`/`applyReload`/`consumeSupply` são usados pelo
  cartão do encontro **e** pelo melhoriário; `rollAttack` debita 1 bala (piso em 0, a UI é quem bloqueia com
  `🔫 Sem munição`). **Mesa online só espelha**: `mesaEnemySeed.supplies` → migração
  `20260930000000_mesa_combatant_supplies.sql` → coluna `mesa_combatants.supplies`, reenviada pela mesma rota
  do HP (`publishMesaEnemySupplies`); com o mesmo molde de degradação do `source_key` (`suppliesSupport`), a
  migração atrasada só tira os chips da linha. **Limitação assumida**: no melhoriário o item de cura aparece
  lido só — aquela tela não gerencia HP de inimigo, a cura acontece em ⚔️ Encontros. Fixado em
  `tests/enemy-supplies.test.ts`.
