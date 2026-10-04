# Contrato do Combat Engine — F1.0

> Relatório da **auditoria arquitetural F1.0**, aprovado em 03/10/2026.
> O relatório original existia apenas na conversa; este arquivo foi a sua
> transcrição para o repositório, feita em F1.1. **Nenhuma decisão arquitetural
> foi reinterpretada** — o texto abaixo é o do F1.0.

---

## 1. Escopo, método e resultado

**Escopo da auditoria.** Mapear onde as regras de Cyberpunk RED realmente moram
hoje, classificar cada função (RULE / ACTION / STATE / RESULT / ADAPTER),
propor os contratos `CombatState`, `CombatAction`, `CombatResult`,
`StateChanges`, `Events` e `Randomness`, fixar as fronteiras de autoridade do
servidor, listar duplicações e divergências e propor um plano incremental F1.1+.

**O que F1.0 NÃO é.** Não implementa o Combat Engine, não faz refactor grande,
não cria regras novas (Aimed/Autofire/Suppressive/ROF/Grapple/Prone/Throw/
NetRunning/Vehicles/Luck/Lifepath continuam no backlog). Se a investigação
revelar que uma mudança arquitetural grande seria necessária, ela é
documentada aqui e **não** é implementada.

**Método.** Leitura dos módulos de regra, dos três contextos de combate e da
suíte de testes; nenhuma alteração de comportamento foi feita.

**Resultado da auditoria.**

```text
Código alterado: nenhum
Tests:   404 passando / 0 falhas
tsc:     PASS
Build:   PASS
Lint:    78 problemas (25 erros + 53 warnings) — baseline conhecida
git diff --check: OK
```

---

## 2. Mapa — onde as regras vivem hoje

### 2.1 Módulos puros de regra (sem DOM/rede/localStorage)

| Arquivo | O que decide | Funções-chave |
| --- | --- | --- |
| `src/lib/combatEngine.ts` | economia de ações, ordem, virada de turno | `resolveAction:126`, `applyAction:172`, `beginTurn:185`, `sortByInitiative:210`, `advanceTurn:229`, `rollEnemyInitiative:265` |
| `src/lib/attacks.ts` | ataque/evasão/recarga da **ficha** | `rollAttack:108`, `rollEvasion:315`, `reloadWeapon:410`, `isRangedAttackType:86` |
| `src/lib/damage.ts` | dano, lesão, death save, cura da **ficha** | `rollDamage:42`, `applyReceivedDamage:57`, `applyAttackDamage:161`, `rollDeathSave:295`, `applyFirstAid:351`, `rollFirstAid:385` |
| `src/lib/initiative.ts` | iniciativa da ficha | `rollInitiative:65`, `getInitiativeModifiers:9` |
| `src/lib/enemyRolls.ts` | rolagens do **inimigo** | `rollEnemyAttack:127`, `rollEnemySkillCheck:227`, `rollEnemyDamage:331`, `getAvailableEnemyAttacks:75` |
| `src/data/enemySupplies.ts` | munição, reserva, plano de recarga | `getAmmoKind:93`, `findAmmoIndexByNames:141`, `planReload:213`, `getEnemySupplies:294` |
| `src/lib/mesa/rollPolicy.ts` | custo de rolagem na mesa | `MesaRollKind:19`, `MESA_ROLL_ACTION:47`, `planRollDebit:134` |

### 2.2 O nó de acoplamento: `src/lib/gmStorage.ts`

`import "client-only"` na **linha 1** e, no mesmo arquivo, **27 funções de
combate puras** — este é o **bloqueador nº 1** para um motor executável no
servidor:

```text
getEvasionBase:434 · getParticipantAttackModifiers:446 · getParticipantDamageExpression:490
getParticipantArmorSP:502 · getParticipantAmmoState:526 · getParticipantReloadState:552
getParticipantHealingItems:584 · getParticipantSupplies:596 · reloadParticipantWeapon:622
applyParticipantHealingItem:654 · createEncounterFromFaction:723 · rollAttack:816
rollEvasion:852 · rollDamage:877 · applyDamageToParticipant:904 · updateParticipantHP:944
addParticipantCondition:957 · removeParticipantCondition:972
```

### 2.3 Adaptadores / fronteira de IO

| Arquivo | Papel |
| --- | --- |
| `src/lib/mesa/store.ts` | único ponto que grava no banco: `appendEvent:880`, `startCombat:943`, `addEnemies:1237`, `syncCombatHp:1438`, `rollInitiativeForAll:1509`, `performAction:1714`, `registerRoll:1804`, `endTurn:1887`, `endCombat:1910` |
| `src/lib/mesa/rollPolicy.ts` | política de custo por tipo de rolagem |
| `src/lib/encounterRoster.ts`, `src/lib/participantSelection.ts`, `src/lib/mesa/encounterSync.ts` | conversão/seleção de estado entre contextos (sem regra) |
| `src/lib/dice.ts` | única porta de aleatoriedade: `rollDice:4` com `Math.random` fixo em `:9` |
| `src/lib/mesa/types.ts` | formas persistidas reais: `MesaCombatant:46`, `MesaEvent:80`, `MesaCombat:103`, `MesaState:154` |

---

## 3. Classificação das funções

| Classe | Definição | Exemplos |
| --- | --- | --- |
| **RULE** | decide algo da regra, sem tocar estado persistido | `resolveAction`, `rollAttack`, `applyAttackDamage`, `getAmmoKind`, `planReload`, `MESA_ROLL_ACTION` |
| **ACTION** | executa e **grava** estado | `store.performAction`, `store.syncCombatHp`, `gmStorage.saveEncounter`, `storage.upsertCharacter` |
| **STATE** | forma do estado persistido | `MesaCombat`, `MesaCombatant`, `EncounterParticipant`, `CombatStats`, `EncounterData` |
| **RESULT** | forma do resultado de uma rolagem/ação | `AttackRollResult`, `DamageRollResult`, `EvasionRollResult`, `DamageApplicationResult`, `DeathSaveResult` |
| **ADAPTER** | converte estado de um contexto em outro, sem regra | `toCombatParticipant` (F1.1), `encounterSync`, `buildEncounterRoster`, `summarizeRoll` |

Consequência: **ACTION depende de RULE, nunca o contrário.** Hoje
`gmStorage.ts` mistura STATE (tipos `EncounterParticipant`/`EncounterData`),
RULE (as 27 funções) e ACTION (salvar/carregar) num módulo `client-only` — a
separação dessas três coisas é o trabalho do F1.2.

---

## 4. Dependências e fronteiras do motor

O Combat Engine **não pode** importar React, Next.js, APIs de browser,
`localStorage`, Supabase, DOM, componentes de UI, ou `client-only`. Ele precisa
rodar no servidor e fora do React.

* Hoje, tudo que o motor precisa já é puro **exceto** `gmStorage.ts` (item 2.2).
* `store.ts` é **fronteira de IO**, não regra: nunca entra no motor.
* Tipos de estado (`mesa/types.ts`) são importáveis por tipo (`import type`),
  inclusive pelo servidor.
* `crypto.randomUUID()` e `new Date()` dentro de resultados **não bloqueiam
  replay**: o replay reconstrói o estado e compara valores de regra, não
  identificadores nem carimbos de tempo.

---

## 5. `CombatState`

Estado completo do combate, imutável de um `execute()` para o próximo:

```ts
interface CombatState {
  id: string;                          // MesaCombat.id
  status: CombatStatus;                // "active" | "finished"
  round: number;
  initiativeStarted: boolean;
  activeParticipantId: CombatantId | null;
  participants: CombatParticipant[];
}
```

**Decisões:**

* **Sem `order` redundante.** A ordem é derivada com `sortByInitiative(state.participants)`
  — não se guarda a lista ordenada ao lado da desordenada.
* **Sem relógios.** `turnStartedAt` (existe em `MesaCombat`) é carimbo de UI/servidor,
  não estado de regra.
* **Sem `eventLog`.** Eventos são derivados do `CombatResult` (seção 9).
* **Sem IDs de Supabase** além de `id`, que é o próprio id do combate.
* `economy?` e `deathSave?` ficam **no participante** e são opcionais: nem todo
  contexto os tem (ficha tem death save, encontro não; mesa tem economia, ficha
  não).

---

## 6. `CombatAction`

```ts
type CombatAction =
  | AttackAction        // attack
  | DamageAction        // damage (dano aplicado a um alvo)
  | EvasionAction       // evasion
  | SkillCheckAction    // skill_check
  | MoveAction          // move
  | ReloadAction        // reload
  | HealAction          // heal
  | DeathSaveAction     // death_save
  | InitiativeAction    // initiative
  | ConditionAction     // condition (add/remove)
  | LifecycleAction     // start_combat | end_combat | end_turn
  | OtherAction;        // other
```

**Decisão do eixo de custo.** `CombatAction.type` é o **nome da ação de
domínio** e **não carrega custo**. O eixo de custo continua sendo o
`CombatActionType` existente (`"attack" | "move" | "item" | "other"`,
`ACTION_COSTS` e `MESA_ROLL_ACTION` em `combatEngine.ts:61` e
`rollPolicy.ts:47`), que **não muda**. O mapeamento "esta `CombatAction` custa
quanto" é política e fica para F1.5/F1.7.

---

## 7. `CombatResult`, `CombatRoll`, `CombatError`

```ts
interface CombatResult {
  ok: boolean;
  state: CombatState;                  // estado DEPOIS da ação
  changes: CombatStateChange[];        // seção 8
  rolls: CombatRoll[];                 // tudo que foi rolado
  events: CombatEvent[];               // seção 9
  errors?: CombatError[];
}

interface CombatRoll extends DiceResult {   // { expression, rolls, total }
  kind: CombatRollKind;                // MesaRollKind | "initiative" | "death_save"
  actorId: CombatantId | null;
  targetId?: CombatantId;
}

interface CombatError {
  code: ActionDenialReason | "invalid_state" | "unknown_participant" | "rule_violation";
  message: string;
}
```

`AttackRollResult`, `DamageRollResult`, `ActionDenialReason` e `MesaEvent`
**não mudam** para encaixar aqui: onde for preciso converter, a conversão fica
num adapter posterior (F1.6), não no contrato.

---

## 8. `StateChanges`

Cada mudança de estado é nomeada, com `before`/`after` — é o que permite ao
cliente espelhar HP/condições sem receber o estado inteiro a cada evento:

```ts
type CombatStateChange =
  | { type: "hp_changed";            participantId; before: number; after: number }
  | { type: "is_dead_changed";       participantId; before: boolean; after: boolean }
  | { type: "ammo_changed";          participantId; weaponId: string | null; before; after }
  | { type: "initiative_changed";    participantId; before: number | null; after: number | null }
  | { type: "economy_changed";       participantId; before: ActionEconomy; after: ActionEconomy }
  | { type: "death_save_changed";    participantId; before; after }
  | { type: "conditions_changed";    participantId; before: string[]; after: string[] }
  | { type: "critical_injury_added"; participantId; injury: CriticalInjury }
  | { type: "turn_changed";          activeParticipantId; round: number }
  | { type: "combat_status_changed"; status: CombatStatus };
```

---

## 9. `Events`

* A forma do evento é **`Omit<MesaEvent, "at">`** (o servidor carimba `at`).
* O motor **produz** eventos; **grava** apenas `store.appendEvent:880`
  (`store.ts:880`). Nenhum outro ponto escreve no `event_log`.
* Eventos são derivados do resultado: `CombatResult.events` → `appendEvent`.

---

## 10. `Randomness`

```ts
interface RandomSource {
  roll(expression: string): DiceResult;   // "3d6", "1d10", ...
  d10(): number;
}
```

* É o **último parâmetro opcional** das funções que sorteiam; sem ele, o
  default é `rollDice` (hoje `Math.random`, `dice.ts:9`) — mesmo molde de
  `getEnemySupplies(rng)` em `enemySupplies.ts:294`.
* Isso torna o motor **testável deterministicamente** sem mock de `Math.random`.
* `crypto.randomUUID()`/`new Date()` **não** entram no `RandomSource`: não são
  aleatoriedade de regra (seção 4).

---

## 11. Autoridade do servidor

* **Fronteira:** regra pura (motor) de um lado, `store.ts` (IO) do outro. O
  motor nunca abre conexão nem lê `localStorage`.
* **Hoje:** o servidor já valida permissão, turno, ordem e economia de Actions
  (`resolveAction` roda no servidor — ver comentário em `combatEngine.ts:10-13`),
  mas **não** valida o resultado de um ataque: dano/HP/SP/condições/lesões/
  death saves são calculados no navegador e apenas replicados
  (`PENDENCIAS.md:194`, "Entrega 3 pendente").
* **Alvo F1.7:** o cliente envia a `CombatAction` (não o resultado), o servidor
  monta o `CombatState` do banco, chama `engine.execute(state, action, rng)` e
  grava `state + changes + events` do `CombatResult`.
* **Aleatoriedade:** quando o servidor passar a rolar, o `RandomSource` vive lá
  — o cliente nunca mais envia totais.

---

## 12. Duplicações (11)

1. `rollAttack` da ficha (`attacks.ts:108`) × `rollAttack` do encontro
   (`gmStorage.ts:816`) × rolagem da mesa (`store.registerRoll:1804`) — três
   portas para o mesmo eixo.
2. `rollEvasion` da ficha (`attacks.ts:315`) × `rollEvasion` do encontro
   (`gmStorage.ts:852`).
3. `rollDamage` da ficha (`damage.ts:42`) × `rollDamage` do encontro
   (`gmStorage.ts:877`).
4. Aplicação de dano: `applyAttackDamage`/`applyReceivedDamage` (`damage.ts:161/57`)
   × `applyDamageToParticipant` (`gmStorage.ts:904`).
5. Recarga: `reloadWeapon` (`attacks.ts:410`) × `reloadParticipantWeapon`
   (`gmStorage.ts:622`) — a **regra de escolha da munição** foi unificada em
   F0.6 (`getAmmoKind`/`findAmmoIndexByNames`), mas os dois fluxos seguem.
6. Base de evasão: `rollEvasion` (ficha) × `getEvasionBase` (`gmStorage.ts:434`).
7. Bônus de implantes: `enemyCyberware.ts:33` (lista de perícias à distância) e
   `enemyCyberware.ts:90` (mesmos rótulos/ordem de `attacks.ts`) espelham a
   ficha — inclusive `RANGED_SKILL_IDS`, que **não é exportado** de `attacks.ts`.
8. Iniciativa: `initiative.ts:65` (ficha) × `rollEnemyInitiative`
   (`combatEngine.ts:265`) × `rollInitiativeForAll` (`store.ts:1509`).
9. HP do inimigo: `updateParticipantHP` (`gmStorage.ts:944`, local) ×
   `syncCombatHp` (`store.ts:1438`, mesa) — dois caminhos que espelham o mesmo
   valor.
10. Condições: `addParticipantCondition`/`removeParticipantCondition`
    (`gmStorage.ts:957/972`) × `MesaCombatant.conditions: string[]`
    (`mesa/types.ts:46`) — mesmo conceito, duas formas (`{id,name}` × `string[]`).
11. Leitura de munição: `getParticipantAmmoState` (`gmStorage.ts:526`) ×
    `Weapon.ammo/magazine` da ficha × `MesaSupplies.ammo/magazine`
    (`mesa/types.ts:37`) — três lugares que dizem "quantas balas restam".

---

## 13. Divergências (13)

1. **Death Save existe só na ficha** (`damage.ts:295`); inimigo e mesa não rolam
   (inimigo só é "clampeado" em 0).
2. `deathSaveModifier`/`deathSavePenalty` **nunca são aplicados** em
   `rollDeathSave` — a DC sai sempre do `deathSaveDC` cru.
3. `rollCriticalInjury(existingInjuries)` **nunca é chamado com a lista** de
   lesões existentes → lesão repetida é possível.
4. **Não existe limiar de 25%** em lugar nenhum dos contextos.
5. `applyReceivedDamage` (`damage.ts:57`) **não recebe contexto de ataque**: o
   SP meio de Artes Marciais só existe em `applyAttackDamage` (`damage.ts:161`).
6. `ignoreArmor` (alavanca do GM) **não é** a meia-SP de Artes Marciais — duas
   alavancas diferentes para "furou a armadura".
7. Attack Modes **só custam munição** (10 em autofire/suppressive, 1 no resto) e
   `attackMode` **não entra** nem no `rollHistory` nem em `MesaEvent`.
8. ROF é **informativo**: não limita nada.
9. Munição pode chegar a **0 em silêncio** — a ação acontece e o pente só fica
   vazio.
10. **Efeitos de alvo são reportados e não aplicados** (condições/PRONE/etc.).
11. Inimigos **ignoram penalidade de ferimento**: existe
    `calculateWoundThreshold` (`lib/calculations`) para a ficha, mas nenhum
    caminho do inimigo o usa.
12. **Modelo de estado divergente**: a ficha não tem `conditions` nem
    `initiative`; o encontro não tem `BODY`, `criticalInjuries` nem `deathSave`;
    a mesa tem tudo (e em `conditions: string[]`).
13. **Números homônimos diferentes**: `Skill.level` (ficha) ×
    `EncounterParticipant.skillValue` — este é `REF + nível`
    (`gmStorage.ts:752`), não o nível; tratar um como o outro duplica o STAT.

---

## 14. Plano incremental F1.1 → F1.8

| Etapa | Entrega | Restrição |
| --- | --- | --- |
| **F1.1** | `src/lib/combat/contract.ts` (tipos) + `toCombatParticipant()` para `Character` e `EncounterParticipant` + testes de contrato | só contrato e adapters; **zero** mudança de comportamento |
| **F1.2** | Tirar as 27 funções de combate de `gmStorage.ts` para um módulo puro, **re-exportando** de lá | sem mudança de comportamento; remove `client-only` do caminho do motor |
| **F1.3** | Um único `applyDamage(participant, roll, policy)` para ficha/encontro/mesa | converte os itens 4 e 9 da lista de duplicações |
| **F1.4** | `RandomSource` como parâmetro opcional em `rollDice` e nos módulos de rolagem | default inalterado |
| **F1.5** | `engine.execute(state, action, rng) → CombatResult` | puro, sem IO |
| **F1.6** | `CombatResult.events` → `appendEvent` | único ponto de gravação de eventos |
| **F1.7** | Validação de rolagem no servidor (fecha "Entrega 3 pendente") | cliente envia ação, não resultado |
| **F1.8+** | condições, ROF, Attack Modes mecânicos e o backlog §13 | regra nova só com aprovação explícita |

**Fora do F1 (backlog):** Grapple/Prone/Throw/NetRunning/Vehicles, Luck e
Lifepath, death save de inimigo, limiar de 25%, penalidade de ferimento para
inimigos, `attackMode` em histórico/eventos.
