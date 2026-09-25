This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Discord (espelho de rolagens)

O site pode publicar as rolagens já calculadas em um canal do Discord. O bot **não rola dados** — ele apenas reproduz o resultado produzido pelo site. Um **único bot** atende vários servidores: cada mesa escolhe servidor e canal. O envio usa a **API REST** do Discord (sem gateway), estável no serverless da Vercel.

1. Crie o bot em <https://discord.com/developers/applications>, copie o token e convide-o para os servidores (permissões apenas **Ver canal** e **Enviar mensagens** — não use *Administrator*).
2. Crie um projeto no [Supabase](https://supabase.com) e rode o SQL de `supabase/migrations/20260923120000_mesa_discord_configs.sql` no SQL Editor (cria só a tabela `mesa_discord_configs`).
3. Copie `.env.example` para `.env.local` e preencha:

```env
DISCORD_BOT_TOKEN=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

4. Inicie o projeto (`npm run dev`). Na primeira visita o site pergunta se você quer enviar as rolagens ao Discord; a escolha pode ser alterada depois em 🎲 Dados.
5. Em **🎲 Dados → Discord**: gere/defina o **código da mesa** (ex.: `night-city`) e clique em **⚙ Configurar servidor** para escolher o servidor e o canal. Os jogadores usam o mesmo código da mesa.
6. Ao rolar na ficha com o envio ativado, a mensagem aparece **somente** no canal do servidor vinculado àquela mesa.
7. Para o deploy: adicione as três variáveis acima também em **Vercel → Settings → Environment Variables** e faça redeploy.

Detalhes:

- O banco guarda **apenas** `sessionCode → guildId → channelId` (nenhuma rolagem, ficha ou personagem). RLS habilitado sem policies: só o servidor (service role) acessa.
- Sem consentimento ou sem código de mesa, **nenhuma informação sai do navegador**.
- Token e chaves ficam só no servidor (env server-side) e nunca chegam ao navegador — nada de `NEXT_PUBLIC_*`.
- Se o Discord ou o banco falhar, a rolagem do site continua funcionando normalmente.

## Cyberware: o que já aplica efeito

O catálogo (`src/data/items.json`) tem dois campos por item:

- `effects` — texto exibido ao jogador (loja, inventário e ficha).
- `modifiers` — efeito **numérico estruturado**, que é o que o motor realmente aplica. Só entram aqui efeitos **passivos** (sempre ativos enquanto a peça estiver instalada).
- `activation` — efeito **ativável**: define os estágios de um **toggle manual** no card do cyberware. Enquanto a peça está inativo nada é aplicado; ligando o toggle entram em vigor os `modifiers` daquele estágio.
- `action` — habilidade disparada por botão (`heal`), liberada só enquanto a peça está ativada.

Quem lê `modifiers`/`activation` é `src/lib/cyberwareEffects.ts`, consumido por `rollSkillCheck`, `rollAttack`, `rollEvasion`, Iniciativa, dano (`src/lib/damage.ts`) e instalação (`src/lib/cyberware.ts` / `src/lib/inventory.ts`). Todo bônus aplicado aparece creditado no histórico de rolagens como `Cyberware (Nome)`.

| Cyberware | Efeito aplicado |
| --- | --- |
| Gorilla Arms | +2 Brawling · ataque desarmado +1d6 |
| Audio Filter | +2 Percepção |
| Reinforced Tendons | +2 Athletics (testes de salto) |
| Targeting Scope | +1 em ataques à distância |
| Smart Weapon Link | +1 em ataques com armas Smart |
| Subdermal Armor / Skin Weave | SP 11 / 7 no corpo (não acumula com armadura: vale o maior) |
| Mantis Blades / Monowire / Projectile Launch System | viram arma própria na instalação (saem da ficha junto na remoção) |

**Requisitos (`requires`)** — verificados ao instalar/equipar, com a mensagem de erro exibida no inventário:

- `neural_link` é exigido por todo cyberware da subcategoria *neuralware* (Sandevistan, Kerenzikov, Reflex Tuner, Combat Awareness Processor, Smart Weapon Link).
- `cybereye` / `cyberaudio` para aprimoramentos óticos e auditivos — o Cybereye aceita **no máximo 2** aprimoramentos óticos.
- `smart_link` para equipar armas Smart.

**Aproximações assumidas** (o motor não modela o contexto ainda): Targeting Scope vale para qualquer ataque à distância (não existe noção de alcance) e Reinforced Tendons soma +2 em qualquer teste de Athletics (não existe teste de salto isolado).

### Ativação manual (toggle por peça)

Sem sistema de rodadas de combate, os efeitos ativáveis usam um **toggle manual** no card do cyberware: o botão percorre os estágios (inativo → estágio 0 → estágio 1 → ... → inativo). Duração, "1 vez por combate" e o número de usos ficam a cargo do jogador — o toggle é a trava, não um cronômetro.

| Cyberware | Estágios | Efeito aplicado |
| --- | --- | --- |
| Sandevistan | Acelerado | +4 Iniciativa · +1 Evasão (o "+1 REF em testes de reação") |
| Kerenzikov | Em movimento | +2 Iniciativa · +1 Evasão |
| Combat Awareness Processor | Em combate | +2 Percepção |
| Optical Camo | Camuflagado | +4 Furtividade |
| Adrenaline Booster | Impulso → Rescaldo | +2 MOVE (exibido no atributo) → −1 em testes físicos |
| Pain Editor | Ignorando dor | anula o `−2` de lesão grave (HP) em First Aid, perícia, ataque e Evasão |
| Reflex Tuner | Pronto para repetir | libera o botão **↻ Repetir** na Iniciativa; usar desliga a peça |
| Nano Repair | Rodada ativa | libera **✚ +2 HP** (não cura acima do máximo) |

**Penalidade de lesão grave (pendência nº 4, corrigida)**: `getWoundPenalty` (`src/lib/calculations.ts`) é a fonte única — devolve `−2` quando o personagem está Seriously/Mortally Wounded e `0` quando o Pain Editor está ativo. Vale em First Aid, `rollSkillCheck`, `rollAttack`, `rollEvasion` e **Iniciativa**; em todas elas aparece como tag **"Lesão grave (HP)"** nos modificadores, para o jogador ver de onde veio o `−2`. Fora do escopo seguem só as rolagens de **inimigo do GM** — anotado em [`PENDENCIAS.md`](./PENDENCIAS.md).

### Matemática das rolagens

Uma identidade vale para os quatro rolls e é o que a ficha desenha na tela:

```
total = STAT base + perícia + d10 + Σ(modificadores)
```

- `rollSkillCheck` e `rollAttack` contam a penalidade de **STAT** da lesão **uma vez só** (ela aparece como tag; o STAT exibido é o base) — antes contava em dobro nos dois.
- `rollAttack` conta `context.modifiers` **uma vez** — antes entrava duas vezes.
- Ataque com **arma** leva os modificadores de lesão "Distância" / "Corpo a corpo" — antes nenhum ataque com arma levava, porque a detecção olhava `context.type` (sempre `"weapon"`) em vez do tipo resolvido; a lista também passou a usar `AttackType` (incluindo `smg`).
- **Iniciativa** saiu do componente para `src/lib/initiative.ts` e agora leva cyberware, lesões e a lesão grave.

Fixado em `tests/roll-modifier-math.test.ts` e `tests/initiative.test.ts`.

### Validação ataque × dano

`tests/cyberware-combat-matrix.test.ts` fixa, por cenário, as duas coisas separadamente:

1. **expressão de dano** do resultado do ataque (`result.damageDice`) — é o que o botão *Rolar Dano* usa;
2. **modificadores do ataque** (`result.modifiers`) — e o total tem de bater com `stat + perícia + d10 + modificadores`, provando que cada bônus conta **uma única vez**.

O bônus de dano (`unarmed_damage`) nunca aparece como modificador de ataque e nenhum bônus de ataque muda a expressão de dano. `rollDamage` confirma que a quantidade de dados rola de verdade. Cobertura: Gorilla Arms (Brawling, Martial Arts, arma de Brawling, arma melee), Targeting Scope, Smart Weapon Link, armadura de cyberware e Mantis Blades.

Para não ficar no "confia", a ficha mostra a **composição do dano** logo abaixo do botão (*Rolar Dano (3d6)* → `Base (BODY 5): 2d6 · Gorilla Arms: +1d6`). O campo vem de `result.damageSources`, preenchido em `rollAttack` para ataques desarmados; armas não têm composição, porque o dano é o da própria arma. `tests/cyberware-damage-e2e.test.ts` repete o fluxo exato da UI (lista de ataques → ataque → dano → aplicação) para BODY 2/5/7/9 com e sem Gorilla Arms, nos dois golpes desarmados.

**Decisão**: Gorilla Arms **não** dá +2 em Martial Arts (o efeito declarado é "+2 Briga"); o +1d6 de dano vale para os dois, por ser efeito de ataque desarmado.

### Validação Pain Editor

`tests/pain-editor-validation.test.ts` cobre três frentes:

1. **First Aid** → o `−2` sai da conta quando o toggle liga (`injuryModifier` vai de `−2` para `0`, diferença exata de 2) e volta quando desliga. Rodando em HP 0/40 (Mortally Wounded).
2. **Escopo** → ele ignora **só** o `−2` vindo do HP. Uma Critical Injury de `−2 em todas as ações` continua valendo mesmo com o implante ligado (`−4` com toggle off, `−2` com toggle on).
3. **Perícia, ataque e Evasão** → com HP 10/40 e HP 0/40 os três rolls perdem exatamente 2 pontos contra o mesmo personagem saudável (e a tag "Lesão grave (HP)" aparece nos modificadores). Ligar o Pain Editor devolve os três ao valor do personagem saudável e some a tag.

### Brawling e Martial Arts

Regras implementadas em 25/09/2026 (`tests/martial-arts.test.ts` cobre cada item):

- **Dano por BODY**, igual para os dois golpes: `1–4 = 1d6 · 5–6 = 2d6 · 7–10 = 3d6 · 11+ = 4d6`
  (fonte única: `getUnarmedDamageDice`; **BODY 9/10 passou de 4d6 para 3d6** — a pendência nº 6 era o
  teste que esperava `2d6` num BODY 2, e estava errado).
- **Cyberarm = piso de 2d6**: com qualquer cyberarm instalado o desarmado não fica abaixo de `2d6`, e o
  **+1d6 do Gorilla Arms continua somando por cima** (decisão da mesa: piso **+** bônus, não piso no lugar
  do bônus — BODY 5 com Gorilla Arms segue em `3d6`).
- **Quatro formas são perícias separadas**: `Martial Arts (Karate)`, `(Taekwondo)`, `(Judo)`, `(Aikido)`,
  categoria `fighting`, custo duplo, sem nível obrigatório na criação. Cada ataque rola **só o nível da
  forma escolhida** — Karate 4 + Aikido 3 nunca valem 7. A ficha lista uma entrada por forma com ≥1 ponto
  (e mantém a genérica `Martial Arts` quando não há nenhuma forma).
- **ROF 2** aparece no detalhe de todo ataque por perícia (Brawling e formas).
- **Martial Arts ignora metade do SP, arredondando para cima** (SP 11 → 6): vale no caminho
  `rollAttack → rollDamage → applyAttackDamage`, que carrega `attackType` até lá, e a ficha avisa embaixo
  do dano. Brawling e armas continuam usando o SP cheio.
- **Special Moves** (`src/data/specialMoves.ts`): os 9 moves (Recovery + 8 por forma) aparecem no Card 03
  com o requisito original, o efeito original, a perícia que será usada e o motivo do bloqueio em vermelho.
  Requisitos estruturados: perícia da forma, `WILL 8+`, `MOVE 8+` e as flags do turno. `check` rola a
  perícia da forma vs o DV do JSON; `attack` (Bone Breaking Strike, Pressure Point Strike, Flying Kick)
  vira um **ataque de Artes Marciais normal** — mesma lista, mesmo botão de dano, mesma regra de SP.
- **Special Moves começam travados e custam 1 ponto** (decisão da mesa de 25/09/2026): os
  pontos vêm da perícia-mãe **Martial Arts** (1 ponto por nível; MA 4 = 4 pontos). O mesmo
  bolso paga **especializações** (custo escalonado: Karate 1 = 1 pt, Karate 2 = 2 pt…) **e**
  desbloqueio de moves. O card mostra o saldo (`nível 4 = 4 pts · 3 em especializações · 1 em
  moves · 0 livre`), badge `Liberável`/`Travado`, botão **🔓 Desbloquear** e **↺ Devolver o
  ponto**. Requisitos originais continuam valendo depois de pago. Testes:
  `tests/martial-arts.test.ts` (pool único, devolução, recusa).

**Fora do escopo desta rodada** (detalhado em `PENDENCIAS.md`): Grapple/Grab/Choke/Throw não existem no
app, ROF 2 é informativo (não há economia de ações), o estado do turno é **manual** no painel do Card 03 e
efeitos que miram um alvo (lesões, ablação, Prone) são **relatados**, não aplicados — a ficha do jogador
não tem alvo.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
