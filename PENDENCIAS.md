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
- **Iniciativa: base `REF + 1d10`** — é a fórmula que a ficha já usava. O manual do CPR pode mandar
  `REF + DEX + 1d10`; mudar isso altera toda Iniciativa da mesa, então ficou como está e fica a pergunta.
- **Inimigos do GM** (`src/lib/enemyRolls.ts`) também não têm penalidade de HP nas rolagens deles.
  Fora do escopo das correções, que eram sobre a ficha do jogador.

## Decisões tomadas (não são bug)

- **Gorilla Arms não dá +2 em Martial Arts** (validado em 25/09/2026). O dado declara "+2 Briga"
  (`skill: brawling`); Martial Arts é outra perícia. O **+1d6 de dano vale para os dois**, porque é
  efeito de *ataque desarmado* e não de perícia. Comportamento fixado em
  `tests/cyberware-combat-matrix.test.ts` — se um dia mudar, esse teste é o que avisa.

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
