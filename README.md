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

## Mesa online (modo grupo)

Além do modo local (ficha, criação, combate e rolagens funcionando **sem servidor**), o app permite jogar em grupo: um GM cria uma **mesa**, os jogadores entram por um código de 5 caracteres e o **combate é compartilhado** em tempo real.

### Self-host local no Windows/WSL2 via LAN ou Radmin VPN

Há dois modos explícitos e sem fallback: `MESA_HOSTING_MODE=supabase` mantém o
backend remoto; `MESA_HOSTING_MODE=local` usa PostgreSQL local e não chama
Supabase nos fluxos locais suportados. O procedimento de instalação com Node,
PostgreSQL, migrations, backup e firewall está em
[`docs/self-host-windows.md`](docs/self-host-windows.md). O instalador
reprodutível fica em `installer/windows/`.

O host local ainda é HTTP (sem TLS embutido), e a VPN não substitui
autenticação, autorização ou firewall.

No computador hospedador:

```powershell
npm install
npm run build
npm run start:lan
```

O comando acima escuta em `0.0.0.0:3000`. Para restringir o processo ao IP
virtual do Radmin, use o IP mostrado pelo Radmin no Windows:

```powershell
npm run start -- --hostname <IP_RADMIN_DO_MESTRE> --port 3000
```

O Mestre pode testar localmente em `http://localhost:3000`. Os jogadores devem
usar `http://<IP_RADMIN_DO_MESTRE>:3000`, nunca o IP interno do WSL por
presunção.

#### WSL2 e Radmin

Este projeto pode executar dentro do WSL2, mas o adaptador Radmin pertence ao
Windows. O IP de `wsl hostname -I` não é o IP Radmin. Primeiro teste o acesso
ao serviço pelo Windows. Se o WSL estiver em NAT (e não em *mirrored
networking*), o Windows pode precisar de um encaminhamento **no próprio host**
entre o IP Radmin e o IP atual do WSL; isso não é port forwarding do roteador:

```powershell
wsl hostname -I
netsh interface portproxy add v4tov4 listenaddress=<IP_RADMIN_DO_MESTRE> listenport=3000 connectaddress=<IP_WSL> connectport=3000
```

Remova-o quando necessário:

```powershell
netsh interface portproxy delete v4tov4 listenaddress=<IP_RADMIN_DO_MESTRE> listenport=3000
```

O IP do WSL pode mudar após reiniciar; não fixe esse valor sem verificar. Uma
alternativa é habilitar o *mirrored networking* do WSL2 e repetir o teste, sem
assumir que ele está habilitado.

#### Windows Defender Firewall

Não desative o firewall e não configure encaminhamento no roteador. Crie uma
regra TCP restrita ao adaptador Radmin e, idealmente, aos IPs dos jogadores:

```powershell
New-NetFirewallRule -DisplayName "Cyberpunk RED Mesa - Radmin" `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 `
  -InterfaceAlias "Radmin VPN" -RemoteAddress <IP_DOS_JOGADORES> -Profile Any
```

Substitua `<IP_DOS_JOGADORES>` por uma lista autorizada separada por vírgula.
Se o Windows não aceitar a restrição de interface no ambiente, mantenha a
regra limitada aos endereços Radmin e confirme a regra efetiva com:

```powershell
Get-NetFirewallRule -DisplayName "Cyberpunk RED Mesa - Radmin" | Get-NetFirewallPortFilter
```

As variáveis server-side continuam somente no processo Node:
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e, opcionalmente,
`DISCORD_BOT_TOKEN`. Para Realtime, o build também precisa de
`NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`; sem elas, o app
usa polling de segurança em vez de Realtime. Nunca coloque a service role key
em uma variável `NEXT_PUBLIC_*`.

### Configuração

No deployment online, configure explicitamente `MESA_HOSTING_MODE=supabase`
nas variáveis server-side da Vercel. A seleção pertence ao ambiente do servidor,
não ao modal público de criação de Mesa. O token administrativo do host é
exclusivo do self-hosted e nunca é necessário para jogadores do site.

1. Rode no SQL Editor do Supabase (junto com a migração do Discord) os arquivos `supabase/migrations/20260926000000_mesa_sessions.sql`, `supabase/migrations/20260927000000_mesa_combatant_source_key.sql`, `supabase/migrations/20260927000001_mesa_battles.sql` e `supabase/migrations/20260930000000_mesa_combatant_supplies.sql` — as tabelas `mesa_sessions`, `mesa_participants`, `mesa_characters`, `mesa_combats`, `mesa_combatants` e `mesa_battles` (RLS habilitado sem policies: só o servidor acessa, via service role) e as colunas `mesa_combatants.source_key` (identifica **qual inimigo do encontro** é cada linha da mesa; sem ela o app funciona, só não espelha a vida dos inimigos) e `mesa_combatants.supplies` (a **mochila do inimigo** — pente, reserva e cura; sem ela a linha da mesa não mostra munição nem item de cura). A tabela `mesa_battles` guarda o **histórico de partidas** e torna cada encontro de uso único (sem ela o combate continua funcionando, só não há histórico nem bloqueio de encontro repetido). As duas colunas são opcionais: o servidor detecta a ausência, regrava sem elas e o combate começa do mesmo jeito.
2. Adicione ao `.env.local` (as duas últimas variáveis são públicas, vão para o navegador):

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SUPABASE_URL=        # mesma URL do projeto
NEXT_PUBLIC_SUPABASE_ANON_KEY=   # Project Settings → API → anon public
```

3. Sem as variáveis `NEXT_PUBLIC_*` o app não quebra: o modo online passa a usar **polling de 4s** em vez do Realtime. Para tempo real de verdade, preencha-as.

### Como testar com 2+ pessoas (navegadores diferentes)

1. `npm run dev` e abra `http://localhost:3000` no navegador A (o GM).
2. Na ficha, clique em **🌐 Mesa online** → **[CRIAR MESA]** → nome do GM → **Criar**. A sala abre como **painel sobre a própria ficha** (a URL continua sendo a tela principal); o link de convite é `http://localhost:3000/mesa/XXXXX`.
3. No navegador B (ou uma janela anônima), abra a mesma ficha e clique em **🌐 Mesa online** → **[ENTRAR EM MESA]** → digite o código → **Entrar**. (O link direto `http://localhost:3000/mesa/XXXXX` também funciona: leva à mesma tela principal com o painel já aberto — **não** existe tela separada de mesa.)
4. Cada um associa um personagem (**📋 Usar este personagem na Mesa** — uma cópia da ficha vai ao servidor para validação das regras).
5. O GM abre **⚔️ Encontros**, cria o encontro (facção, nível, inimigos) e clica em **[ ⚔ Iniciar combate na Mesa ]** — os inimigos criados ali entram na mesa partilhada. Depois é só **[ ROLAR INICIATIVA ]** (**1d10 + REF** — sem regra de crítico: o d10 extra não vale para Iniciativa) e **▶ Iniciar Turno**: jogadores agem só no próprio turno e com as 2 Actions do turno; o servidor rejeita qualquer ação fora disso (a UI apenas esconde os botões).
6. **Economia de ações**: `attack/item/other` custam 1 das 2 Actions; **mover custa 0 Actions** e sai de um orçamento próprio de **MOVE × 2 metros por turno** (MOVE 10 → 20 m, com o bônus de cyberware já somado). O jogador digita os metros no campo ao lado de **[ MOVER ]** e o servidor valida o que sobrou. Inimigos usam o MOVE do bestiário (`moveStat`).
7. Sem abrir o painel, role um ataque na ficha (**🎲 Rolar ataque**, card 03) e reabra a mesa: a rolagem já está em **Dados na mesa** e as Actions do turno foram debitadas.
8. Repita o teste publicando em dois dispositivos (mesma LAN ou via túnel/ngrok).

### Electron entrando em uma Mesa hospedada remotamente

O Electron inicia um host local por projeto e, por isso, um código digitado
nele consulta o PostgreSQL local por padrão. Códigos não são globais entre
hosts. Para entrar em uma Mesa hospedada em outro servidor, informe a origem
explicitamente no campo **Servidor remoto** do formulário de entrada, por
exemplo `http://26.50.194.224:3001`. A origem fica salva apenas no perfil local
do aplicativo e não há fallback automático para outro banco.

O servidor remoto precisa estar atualizado com a versão que contém `src/proxy.ts`;
isso permite as chamadas autenticadas do renderer Electron sem expor o
PostgreSQL. O `x-mesa-token` continua sendo obrigatório para as rotas de Mesa.

> O **código da mesa do Discord** (`🎲 Dados`) é uma coisa diferente do **código de convite da Mesa** (`joinCode`, 5 caracteres). Convite = quem entra na sessão; Discord = para onde a rolagem é publicada.

### Onde a mesa vive na interface

A mesa **não é uma tela separada**. O botão **🌐 Mesa online** fica sempre no nav da ficha; criar/entrar abre a sala como **painel por cima da tela principal** (`MesaRoomDock`), e fechar devolve a ficha exatamente como estava. A rota `/mesa/XXXXX` só existe para o link de convite e monta **a mesma tela principal** com o painel já aberto. O estado "qual mesa está aberta" vive em `src/lib/mesa/mesaUiStore.ts` (em memória — recarregar a página fecha o painel; reabre pelo nav).

**A conexão não depende do painel.** Enquanto houver assinatura em `membershipStore`, o jogador continua na mesa mesmo com o painel fechado (a ficha, o inventário e as rolagens locais seguem funcionando normalmente); o botão do nav vira um indicador **`● Mesa XXXXX`** para mostrar isso. Só há **dois** caminhos de saída:

- o jogador clicar em **[ Sair da mesa ]** — no rodapé da sala ou ao lado de cada mesa na lista do nav (`DELETE /api/mesa/[id]/participant` some com ele na lista de jogadores; o Mestre só pode sair depois de encerrar a sessão);
- o Mestre **encerrar a sessão** — aí todos caem fora sozinhos, inclusive quem estava com o painel fechado (a conferência acontece ao abrir a tela e, com o painel aberto, em tempo real).

O **[ ⚔ Iniciar combate na Mesa ]** mora em **⚔️ Encontros** (`/gm/encounters`), ao lado do encontro que o Mestre acabou de montar: é dali que os inimigos entram na mesa partilhada. O painel da mesa só aponta para essa tela.

### Dados rolados na ficha valem na mesa

Enquanto o jogador estiver conectado, **o dado rolado na CharacterSheet é a ação da mesa** — não é preciso repetir o clique no painel:

- O espelho acontece no mesmo ponto do espelho do Discord (`CharacterToolkit.onUpdate` → `publishMesaRoll`), **fire-and-forget**: mesa encerrada ou rede fora nunca quebra a ficha local; sem assinatura ativa nada é enviado (modo local intacto).
- `POST /api/mesa/[id]/combat/roll` valida no servidor com a **mesma `resolveAction`** do botão ATAQUE. No turno do jogador, **ataque, testes de perícia e Evasão debitam 1 Action**. Fora do turno ou sem Actions sobrando, a rolagem **ainda entra no registro**, marcada com o motivo (`· fora do seu turno`, `· sem Actions sobrando`).
- **Dano, dano recebido e rolagem livre/iniciativa** entram no registro **sem custar Action** (pertencem ao mesmo ataque ou não são ação de combate).
- As linhas aparecem em **Dados na mesa** (topo do painel de combate) e no **Registro do combate**, com nome, total e expressão: `Zuberi: Ataque Pistola 17 (REF 6 + 1d10 [7])`.
- Sem combate ativo não há registro: a rolagem não é enviada (`registered: false`). Tipos sem significado na mesa (ex.: humanidade) são recusados com `400 invalid_roll`.
- **Mestre na ⚔️ Encontros**: o ataque, a **Evasão**, o dano e a iniciativa rolados para um inimigo do encontro **vinculado à mesa** vão junto com a chave dele (`key` → coluna `source_key`) — **o ataque e a Evasão debitam 1 Action da linha do inimigo** (a Evasão é o mesmo custo da ficha) e o Registro passa a gravar com o nome do inimigo (`Militante: Ataque Fuzil 14 …`). Dano e iniciativa entram sem custo, como sempre. Sem chave (catálogo de inimigos, encontro fora da mesa) a rolagem continua sendo relatório puro.

Os botões **[ ATAQUE ]**, **[ ITEM ]** e **[ MOVER ]** do painel continuam existindo como atalho (GM ou jogador sem ficha aberta) — os dois caminhos passam pela **mesma validação** do servidor. A política (quais rolagens vão e quanto custa) fica em `src/lib/mesa/rollPolicy.ts`, módulo puro compartilhado por navegador, servidor e testes.

### Vida (HP) espelhada na mesa

A vida de quem participa do combate **muda na origem e aparece na mesa para todo mundo**, num sentido só
(ficha/encontro → mesa; nada volta da mesa para a ficha — decisão de 27/09/2026):

- **Jogador**: HP, HP máximo ou morte que mudarem na ficha (`CharacterToolkit.onUpdate` → `publishMesaHp`)
  atualizam a linha do próprio participante em `mesa_combatants.hp_current`. Dano recebido, cura, First Aid,
  item de cura e edição da ficha entram pelo mesmo caminho — tudo fire-and-forget, sem mesa ativa não sai nada.
- **Inimigos**: dano/cura aplicados na tela de **⚔️ Encontros** (`handleApplyDamage` / `handleHeal` →
  `publishMesaEnemyHp`) atualizam a linha correspondente da mesa, identificada pela coluna nova
  **`mesa_combatants.source_key`** (= o `id` estável do participante do encontro, enviado no início do
  combate). É por isso que os encontros ganharam `participant.id` (`ensureEncounterIds` completa os salvos
  antes desta feature).
- `POST /api/mesa/[id]/combat/hp` faz a validação no servidor: sem `key` é o combatente de **quem pediu**;
  com `key` é inimigo — **só o Mestre**. Ele também aceita `supplies` (a mochila do inimigo: pente, reserva
  e cura), que é a mesma rota usada quando o Mestre atira, recarrega ou cura em ⚔️ Encontros.
  Sem combate ativo ou sem linha correspondente devolve
  `updated: false` e nada muda. O estado novo é publicado no Realtime como qualquer outra mutação.
- **Morte**: inimigo com 0 HP sai da ordem de turno e volta com HP > 0 (inimigo não faz death save aqui);
  personagem só é marcado morto quando a **ficha** diz `isDead` — 0 HP com death save pendente continua em jogo.
- **Migração obrigatória para os inimigos**: se `source_key` não existir no banco, o combate continua
  **começando normalmente** (o servidor re-insere sem a coluna) e o espelho de vida de inimigo recusa com
  `503 migration_pending`; o espelho dos jogadores não depende dessa coluna.
- **Migração opcional da mochila**: `mesa_combatants.supplies` (migração `20260930000000`) segue o mesmo
  molde (`suppliesSupport` em `src/lib/mesa/store.ts`) — sem ela o insert e o update do HP simplesmente
  **regravam sem a coluna** e a linha do inimigo fica sem os chips `🔫 3/8 · ✚ 2`. Nada mais muda.
- **Ajuste manual do GM no painel da mesa** (botões −/+) continua possível, mas é **sobrescrito** na próxima
  mudança da origem — quem manda é a ficha do jogador e o encontro do Mestre.

### Encontro vinculado à mesa e histórico de partidas

Quando o Mestre clica **⚔ Iniciar combate na Mesa** na tela de **⚔️ Encontros**, o encontro viaja junto e nasce
uma **partida** em `mesa_battles` (migração `20260927000001_mesa_battles.sql`):

- **O encontro é de uso único** — `mesa_battles.encounter_id` é UNIQUE **no servidor**: quem já entrou em
  combate não inicia luta de novo, em mesa nenhuma (`409 encounter_used`). A tela mostra o selo
  **✅ Concluído** e o botão de início some. Combate avulso (sem encontro) grava `encounter_id = NULL` e não
  bloqueia nada.
- **Durante o combate quem manda é a mesa**: o encontro **puxa** de volta o HP dos inimigos (morte incluída)
  pelo `source_key` — `useMesaState` (Realtime + polling de 4s) → `applyMesaStateToEncounter`, aparado em
  `[0, HP máximo]` para não quebrar o invariante local. O empurrão continua nascendo **só de clique do Mestre**
  (`publishMesaEnemyHp`), então não há loop: ida (encontro → mesa) para **ação**, volta (mesa → encontro)
  para **estado**.
- **A partida fecha sozinha em todo fim de combate**: GM encerrar (`endCombat`), sessão encerrar
  (`finishSession`) ou fim automático com todos os inimigos caídos (`advanceActiveTurn`). A linha vira
  `completed` com o snapshot final — vida de entrada, vida final, quem morreu, quem saiu e a rodada final.
- **Histórico de partidas** vive no fim da tela de Encontros (`GET /api/mesa/[id]/battles`, só GM): lista as
  partidas com selo ✅/⚔ e, ao abrir a tela, **reconcilia** os vínculos locais
  (`reconcileEncountersWithBattles`) — cobre a luta que acabou com a tela fechada e a lançada noutro separador.
- **Reiniciar sem furar a regra**: `restart: true` no `POST /combat` recomeça a **mesma** partida ainda ativa
  nesta mesa (mesma linha no histórico); se quem está ativo é outro encontro, o servidor responde
  `combat_already_active` e a UI encerra antes de entrar. `encounter_used` = concluído (nunca mais);
  `encounter_restart` = recomeço disponível.
- **Migração obrigatória para o histórico**: sem a tabela `mesa_battles` o combate continua **começando
  normalmente** (só sem histórico e sem bloqueio) e `GET /battles` responde `503 migration_pending`.

O vínculo (`EncounterData.battle` no localStorage do Mestre) é **conveniência de UI**; quem bloqueia de verdade
é o servidor.

### Encontro já nasce preenchido

`createEncounterFromFaction` monta cada inimigo já com as duas camadas de papel:

- **2 características de personalidade** (`getRandomTraits(2)`) — desde sempre.
- **Implantes (cyberware), com cota por nível**: nível 1 → 2, 2 → 3, 3 → 4, 4 → 5 implantes
  (`implantCountForLevel` em `src/data/enemyImplants.ts`). A lista **começa pelos `cyberware` que já vêm no
  JSON do inimigo** (`Enemy.cyberware`, preenchido em `gm-enemies.ts`) e só então é completada até a cota
  com sorteio do catálogo de cyberware (`items.json`). Base acima da cota **não é cortada** — o que o
  catálogo do inimigo definiu manda.
- **Mochila: munição garantida e cura só como possibilidade** (`src/data/enemySupplies.ts`). A mochila começa
  pelo `inventory` do JSON do bestiário (`Enemy.inventory`, campo **novo** em `gm-enemies.ts`; nas fichas
  pré-mapeadas ele é relido do texto da nota de GM com `parseInventoryFromNotes`) e aí:
  - **munição**: se o inimigo tem arma de pente **e não trouxe munição compatível**, entra o equivalente a
    **2 cargas cheias** (o que os autores do JSON já fazem à mão). Munição de **outra** qualidade nunca é
    consumida — escopeta não abre caixa de cartuchos de pistola.
  - **cura**: **50% de chance** de ganhar **1 ou 2 unidades** de um item que restaure HP
    (Stim 5, Trauma Injector 2, MaxDoc 10, Bounce Back 6 — `healingSupplyPool()`). Quem já trouxe
    `Trauma Patch` (ou `Combat Stim`/`Protein Pack`) no JSON **não rola nada**.
  Sorteio injetável (`rng`), então o teste fixa o resultado. Fixado em `tests/enemy-supplies.test.ts`.

### Munição e cura do inimigo funcionam como as do jogador

A economia é a mesma da ficha, com a mesma regra escrita uma vez só
(`src/data/enemySupplies.ts` → `planReload`/`applyReload`, `src/lib/gmStorage.ts`):

- **Ataque gasta 1 bala** do pente (`rollAttack`); o pente nunca fica negativo — quem decide se pode atirar
  é a UI, igual ao botão 🔫 desabilitado do jogador.
- **↻ Recarregar** enche o pente e desconta da reserva da mochila (item que zera some), recusando pente
  cheio, munição incompatível e reserva curta com o motivo no `title` do botão.
- **✚ Usar** no item de cura restaura HP **até o teto** e consome 1 unidade.

Onde cada coisa vive:

- **Cartão do participante (⚔️ Encontros)** — é o painel de controle do inimigo: botão 🎲 Atacar que vira
  `🔫 Sem munição` com o pente vazio, linha `↻ Recarregar · pente 3/8 · reserva 13` e seção **🎒 Mochila**.
- **Melhoriário (`/gm`)** — rolagens consomem bala e a seção **🎒 Mochila** recarrega (o pente nasce cheio a
  cada abertura; a cura não tem botão aqui porque a vida do inimigo é gerida em ⚔️ Encontros).
- **Mesa online** — só **espelha** o estado: o seed leva `supplies` para `mesa_combatants.supplies`
  (migração `20260930000000`) e cada tiro, recarregamento e cura reenviam pela mesma rota do HP
  (`publishMesaEnemySupplies`). A linha do inimigo mostra `🔫 3/8 · ✚ 2`; a mesa não rola ataque de inimigo
  nem aplica cura. Sem a migração a coluna simplesmente não entra e a linha fica sem os chips.

Implante de inimigo **entra nos dados que ele rola** (decisão de 30/09/2026): aparece como tag ⚙️ no card do
inimigo e soma em **ataque, Evasão, Iniciativa, dano desarmado e SP do corpo**, exatamente como na ficha do
jogador — a resolução é a mesma (`src/lib/enemyCyberware.ts` monta uma "visão de ficha" e delega para
`src/lib/cyberwareEffects.ts`). Como o inimigo **não tem botão de ativação**, o **primeiro estágio** de cada
peça conta como ligado (é o que faz Sandevistan/Kerenzikov somarem). Fora do escopo: bônus de MOVE. O campo é
opcional: encontros salvos antes desta feature ficam sem a tag (mesma ausência de backfill das personalidades)
e inimigos criados à mão em `/gm/enemies` saem só com o sorteio. Fixado em `tests/enemy-implants.test.ts` e
`tests/enemy-cyberware-rolls.test.ts`.

### Limitações conhecidas (Escopo 1+2)

- **Entrega 3 pendente**: dano/HP/SP/condições/lesões/death saves ainda são resolvidos **no navegador** e apenas replicados para os outros jogadores (o schema e o adaptador `combatEngine.ts` já estão prontos para subir isso para o servidor).
- Sem contas: a identidade é um token anônimo por navegador (`localStorage`); limpar os dados do navegador libera a mesa (o GM pode re-entrar com o mesmo código).
- Sem chat, voz, mapa tático ou VTT — só ficha, lobby e painel de combate compartilhado.
- O Realtime usa **broadcast público por id de sessão** (uuid não adivinhável), não `postgres_changes`.

### Arquitetura em uma linha

`localStorage` continua a fonte da verdade **local**; a Mesa guarda uma **cópia** da ficha em `mesa_characters` (jsonb) para o servidor validar as regras. Toda regra de combate vive em `src/lib/combatEngine.ts` (funções puras), usada **tanto pelo modo local quanto pelo endpoint do servidor** — a única diferença é onde o estado é persistido.

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

**Inimigos da ⚔️ Encontros** também nascem com implantes sorteados por nível — e eles **contam nas rolagens
do inimigo** (ataque, Evasão, Iniciativa, dano desarmado, SP do corpo), com o primeiro estágio de ativação
sempre ligado: ver *Encontro já nasce preenchido*.

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
- **Iniciativa** saiu do componente para `src/lib/initiative.ts` e agora leva cyberware, lesões e a lesão grave. A rolagem em si é **1d10 + REF puro**: **sem regra de crítico** — natural 10 não soma um d10 extra e natural 1 não subtrai (a mesma regra vale para os inimigos, em `rollEnemyInitiative`, e para o **[ ROLAR INICIATIVA ]** da mesa).

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
  categoria `fighting`, custo duplo, sem nível obrigatório na criação. Servem **só para os Special Moves**
  daquela forma (cada move rola **só o nível da sua forma** — Karate 4 + Aikido 3 nunca valem 7).
- **Um card de ataque só** (decisão da mesa de 26/09/2026): a lista "Rolar Ataques" do Card 03 tem **um
  único card `Martial Arts`**, que rola a **perícia-mãe** (`martial_arts`, a de IP). As formas não viram
  cards de ataque próprios. O card só aparece com nível na mãe > 0.
- **ROF 2** aparece no detalhe de todo ataque por perícia (Brawling e formas).
- **Martial Arts ignora metade do SP, arredondando para cima** (SP 11 → 6): vale no caminho
  `rollAttack → rollDamage → applyAttackDamage`, que carrega `attackType` até lá, e a ficha avisa embaixo
  do dano. Brawling e armas continuam usando o SP cheio.
- **Special Moves** (`src/data/specialMoves.ts`): os 9 moves (Recovery + 8 por forma) aparecem no Card 03
  com o requisito original, o efeito original, a perícia que será usada e o motivo do bloqueio em vermelho.
  Requisitos estruturados: perícia da forma, `WILL 8+`, `MOVE 8+` e as flags do turno. `check` rola a
  perícia da forma vs o DV do JSON; `attack` (Bone Breaking Strike, Pressure Point Strike, Flying Kick)
  vira um **ataque de Artes Marciais normal** — mesma lista, mesmo botão de dano, mesma regra de SP.
- **Special Moves abrem pela especialização, sem ponto** (revisão de 30/09/2026; substitui o
  custo de 1 ponto decidido em 25/09/2026): o move libera sozinho quando a especialização da
  forma correspondente está em **nível ≥ 1** — no caso do Recovery (compartilhado), quando
  qualquer forma está ≥ 1. É o mesmo nível que o painel de Especializações sobe, então **não há
  botão de desbloqueio nem devolução**: o card mostra badge `Travado`/`Disponível`/`Bloqueado`,
  a linha `✓ Liberado pela especialização …` ou `Liberação: nível ≥ 1 em …` e o motivo do
  bloqueio em vermelho. Os requisitos originais (WILL 8+, MOVE 8+, flags do turno) continuam
  valendo. Testes: `tests/martial-arts.test.ts` (liberação por nível, formas em 0, recusa).

- **Especializações no Card 03**: as 4 formas (Karate, Taekwondo, Judo, Aikido) **saíram da
  lista de perícias** e ganharam um painel próprio no Card 03, entre Ataques e Special Moves,
  com **↑/↓** para subir/reverter nível (custo escalonado em pontos de MA), saldo do bolso e
  aviso de dívida. A perícia-mãe `Martial Arts` continua na lista de perícias (compra com IP)
  e exibe badge `N pontos livres` — ela é a **única fonte** dos pontos: 1 ponto por nível.

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
