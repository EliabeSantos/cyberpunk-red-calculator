# Self-host local no Windows

O modo local é explícito: `MESA_HOSTING_MODE=local` e PostgreSQL local. Os jogadores acessam somente o Next.js; a porta do PostgreSQL fica em `127.0.0.1`.

## Instalação

O artefato reproduzível fica em `installer/windows/CyberpunkRedCalculator.iss`.
Ele empacota Node.js, PostgreSQL e o build do aplicativo. A pessoa que prepara o artefato executa `scripts/windows/build-installer.ps1` em uma máquina Windows com Inno Setup. O instalador final não exige Node.js, PostgreSQL ou edição manual de variáveis.

Requisitos para montar o instalador: Windows x64, Node/npm apenas na máquina de build, Inno Setup 6 e acesso para baixar os pacotes oficiais de Node.js e PostgreSQL. A máquina do usuário final precisa apenas executar o instalador como administrador.

As versões e hashes SHA-256 dos runtimes estão em `installer/windows/RUNTIME-MANIFEST.md`; o script de build recusa qualquer arquivo baixado que não corresponda ao hash fixado. Inno Setup é necessário somente na máquina de build. Os avisos/licenças distribuídos nos arquivos oficiais de Node.js e PostgreSQL permanecem no pacote.

O instalador inclui Electron, Node.js, PostgreSQL e o build do aplicativo. O atalho abre uma janela nativa sem barra de endereço; o processo Electron inicia ou recupera o host automaticamente, aguarda PostgreSQL, aplica as migrations e só então carrega a interface. Na primeira execução, o bootstrap cria um cluster UTF-8 em `%ProgramData%\Cyberpunk RED Calculator\postgres`, uma configuração protegida, um token administrativo aleatório em `%ProgramData%\Cyberpunk RED Calculator\config\host-admin-token` e aplica todas as migrations. Não copie essa pasta ou o token para chats ou repositórios.

O atalho **Cyberpunk RED Calculator** abre a janela desktop e inicia o host se necessário. O primeiro GM cria o usuário/mesa pela interface; não há usuário ou senha de aplicação padrão. O PostgreSQL empacotado usa a porta local dedicada `55432` (não fica acessível pela LAN). Se a porta web preferida estiver ocupada, o bootstrap escolhe uma porta livre próxima e persiste a escolha em `host.env`; o Electron e as instruções exibidas usam essa porta automaticamente.

O modo de hospedagem não é uma configuração da mesa e não aparece na UI de jogadores ou mestres. Para consultar ou alterar `/api/hosting/config`, use o token do arquivo protegido somente no cabeçalho `Authorization: Bearer <token>` ou `x-host-admin-token`; `x-mesa-token`, `Host`, `Origin` e loopback não concedem administração. A troca entre Local e Supabase grava somente `MESA_HOSTING_MODE` no `host.env` protegido e exige reiniciar o servidor; o processo atual não muda de adapter no meio da execução e a alteração não é permitida enquanto há mesas ativas. O Supabase só aparece se `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já estiverem configuradas no ambiente do host.

## Aplicativo desktop e atualizações

Novas instalações desktop são geradas com Electron Builder/NSIS em modo por usuário. O instalador NSIS fica em `installer/windows/electron-output`; ele instala o aplicativo em uma pasta do usuário e não solicita UAC durante a abertura, execução, migrations normais ou atualização. O instalador Inno Setup em `installer/windows/output` permanece como caminho legado compatível com instalações existentes; ele continua exigindo elevação somente para instalar/atualizar em `Program Files`.

O Electron verifica atualizações somente quando o pacote contém `resources/app-update.yml`, baixa o artefato em segundo plano e oferece reinicialização quando a versão está pronta. Falhas de rede são ignoradas até a próxima tentativa e não impedem o modo local offline. A atualização substitui somente os arquivos do aplicativo; o banco, configurações, token administrativo, mesas e backups ficam em `ProgramData` para instalações legadas ou em `LOCALAPPDATA` para uma instalação desktop nova. Uma instalação nova detecta e reutiliza os dados legados existentes quando eles já estão presentes.

O canal de publicação é GitHub Releases, configurado pelo `publish` do `package.json`. Para publicar uma versão real, faça bump de `version`, crie uma tag/release versionada e execute o build com `npm run dist:windows -- --publish always` em um runner Windows. Configure `GH_TOKEN` somente como secret do CI; nunca o coloque no aplicativo. Para distribuição segura, configure também assinatura de código via `CSC_LINK` e `CSC_KEY_PASSWORD` como secrets. Sem uma release NSIS publicada e assinada, a atualização automática não deve ser considerada operacional nem testada.

O instalador Inno legado não é um alvo seguro para `electron-updater`: seu mecanismo de atualização é diferente do NSIS e ele fica em `Program Files`. A migração para atualizações automáticas ocorre ao instalar uma versão NSIS por usuário; a pasta de dados é preservada, mas essa transição precisa ser validada em Windows real antes de distribuição.

## Toolkit persistido no servidor

Personagens independentes, inimigos personalizados e encontros salvos são gravados pelo servidor em `mesa_toolkit_records`, no PostgreSQL local quando `MESA_HOSTING_MODE=local`. O payload JSON mantém o formato atual (`Character` v2, `Enemy` v1 e `EncounterData`), enquanto `version`, `created_at` e `updated_at` controlam atualizações obsoletas. Encontros continuam sendo registros de preparação; o histórico de batalhas permanece em `mesa_battles` e seus snapshots não são substituídos.

As rotas `/api/toolkit/characters`, `/api/toolkit/enemies` e `/api/toolkit/encounters` não expõem credenciais ao navegador. Personagens usam o token de identidade da Mesa; inimigos e encontros exigem um participante GM autenticado pelo servidor (`sessionId` e `x-mesa-token`). Um jogador comum não consegue listar ou alterar o catálogo privado. Na primeira carga, registros válidos existentes no `localStorage` são importados somente se o ID ainda não existir no servidor; a origem local não é removida antes da confirmação e novas tentativas são idempotentes. Depois da sincronização, `localStorage` funciona apenas como cache/compatibilidade, não como fonte autoritativa.

O acesso aos dados de um navegador diferente ainda requer uma identidade de Mesa válida; a persistência não elimina a necessidade de autenticação. Não copie tokens para URLs, logs ou repositórios.

O token inicial é gerado por fonte criptográfica do Windows, não é fixo nem impresso em respostas HTTP ou logs. Um administrador local pode lê-lo diretamente no arquivo protegido para uma operação administrativa, por exemplo:

```powershell
$token = (Get-Content "$env:ProgramData\Cyberpunk RED Calculator\config\host-admin-token" -Raw).Trim()
Invoke-RestMethod http://127.0.0.1:3000/api/hosting/config `
  -Headers @{ Authorization = "Bearer $token" }
```

Não coloque esse valor em URL, localStorage, scripts client-side ou histórico de shell compartilhado. Tentativas inválidas recebem erro genérico e entram em limitação temporária contra brute force. O token administrativo é diferente do token de mesa do Mestre e dos tokens dos jogadores.

O grupo de atalhos também inclui **Abrir** e **Parar**. O atalho de parada encerra somente o processo cujo PID foi registrado pelo bootstrap, confirma que ele usa o Node empacotado e aguarda sua saída antes de parar o cluster PostgreSQL deste aplicativo. Não encerra processos desconhecidos só porque usam as mesmas portas. Atualizações também executam essa parada e são abortadas se ela não for confirmada.

## Uso e rede

1. Execute o atalho **Cyberpunk RED Calculator** como host.
2. A janela desktop abre a interface e o GM cria a mesa.
3. Use `ipconfig` para descobrir o endereço LAN ou VPN que os jogadores realmente alcançam.
4. Libere TCP 3000 somente para os jogadores:

```powershell
New-NetFirewallRule -DisplayName "Cyberpunk RED Calculator" -Direction Inbound `
  -Action Allow -Protocol TCP -LocalPort 3000 -Profile Private `
  -RemoteAddress <IP_DOS_JOGADORES>
```

Para Radmin VPN, use o IPv4 mostrado pelo Radmin e restrinja a regra a ele e aos IPs dos jogadores. Para outra VPN, use o endereço virtual da ferramenta. Não presuma que uma VPN está configurada e não faça port-forwarding no roteador.

Teste LAN a partir de outro dispositivo, nunca apenas com `localhost`:

```powershell
Test-NetConnection <IP_LAN_DO_HOST> -Port 3000
```

Para VPN, repita o teste usando o IP virtual e mantenha a regra de firewall restrita à interface/endereço da VPN. O projeto não inclui servidor TURN, descoberta automática, TLS ou configuração de VPN; esses componentes precisam existir e ser administrados separadamente.

## Atualização, backup e recuperação

O instalador não remove `%ProgramData%\Cyberpunk RED Calculator`; atualizar preserva mesas, personagens e histórico. O layout instalado é `{app}\app` para o Next.js e `{app}\postgres` para os binários PostgreSQL. Os scripts de backup e restauração resolvem automaticamente `pg_dump.exe` e `pg_restore.exe` nesse diretório; não dependem de PostgreSQL no `PATH`. Em uma instalação, execute-os a partir de `{app}\app`:

```powershell
$env:MESA_LOCAL_DATABASE_URL = "postgresql://mesa_app:<senha>@127.0.0.1:55432/cyberpunk_red"
node .\scripts\backup-local.mjs C:\Backups\mesa-2026-10-09.dump
```

Para um banco/cluster separado, restaure com `node .\scripts\restore-local.mjs C:\Backups\mesa-2026-10-09.dump`. O formato é o **custom archive** do `pg_dump` (`--format=custom`), restaurado com `pg_restore`; ele não é SQL texto. A restauração deve usar PostgreSQL compatível com a versão do servidor de origem e migrations do mesmo aplicativo. O restore recusa destinos não vazios por padrão; para uma substituição deliberada, use `--allow-overwrite` junto de `MESA_RESTORE_CONFIRM=I_UNDERSTAND`, depois valide a mesa restaurada antes de apontar o host para ela. Migrations já aplicadas são verificadas por checksum; uma alteração manual é recusada. A correção de Cover Damage possui migration posterior e o migrador local aceita somente o checksum legado conhecido dessa migration específica.

Se os scripts forem executados fora do instalador, informe explicitamente o diretório que contém os binários: `$env:MESA_POSTGRES_BIN_DIR = "C:\caminho\para\postgres\bin"`. O script recusa continuar quando `pg_dump.exe` ou `pg_restore.exe` não existem. Credenciais são removidas dos argumentos visíveis e passadas por `PGPASSWORD`; não cole URLs com senha em logs ou comandos compartilhados.

Em falha, consulte `%ProgramData%\Cyberpunk RED Calculator\logs`, confirme o processo PostgreSQL e execute o bootstrap novamente. O backup deve ser restaurado em uma instância/banco separado: `restore-local.mjs` recusa destinos não vazios por padrão. Para uma substituição deliberada, use `--allow-overwrite` junto de `MESA_RESTORE_CONFIRM=I_UNDERSTAND`, depois valide a mesa restaurada antes de apontar o host para ela. Atualizar substitui somente `{app}` e mantém `%ProgramData%\Cyberpunk RED Calculator`, incluindo banco, `host.env` e token administrativo. Desinstalar para o host antes de remover o programa e preserva os dados por padrão; não remove banco, backups ou token.

Problemas comuns:

* **Porta ocupada:** o host local escolhe automaticamente uma porta web livre. O PostgreSQL continua preso a `127.0.0.1:55432`; não encerre o `wslrelay.exe` se ele pertencer a outro ambiente.
* **Bootstrap interrompido:** preserve `ProgramData`, consulte `postgres.log` e `host-error.log`, corrija a causa e execute o atalho novamente. Não apague o cluster para “reparar” sem backup.
* **Após reiniciar o Windows:** confirme o atalho em `shell:common startup`; o bootstrap deve iniciar PostgreSQL antes do Next.js.
* **Acesso remoto:** confirme primeiro firewall, IP alcançável e `MESA_HOSTNAME`; nunca exponha a porta 5432.

## Limites

O transporte local de invalidações é em memória. O deployment suportado usa um único processo Next.js; GET autenticado e polling de 4 segundos recuperam eventos perdidos. Não execute duas instâncias apontando para a mesma mesa sem um barramento compartilhado. A atualização da página e a reinicialização do servidor recuperam o estado persistido no PostgreSQL, mas podem atrasar a atualização visual até o próximo polling.

O caminho local já cobre criação/entrada, vínculo de personagem, projeção
isolada, início/reinício de combate, inclusão/edição de inimigos, dano, itens,
iniciativa, movimento, reload, Quickhack, NET/Black ICE, Cover Damage,
encerramento, histórico e fechamento da sessão. Qualquer operação ainda não
migrada deve responder `local_store_path_not_migrated`; não existe fallback
silencioso para Supabase. PostgreSQL, persistência, backup/restauração,
instalador Windows e acesso LAN/VPN continuam exigindo a validação manual
descrita neste documento quando o ambiente real estiver disponível.

Não há TLS embutido. HTTP sem TLS permite interceptação dos tokens de mesa e do token administrativo por alguém com acesso à rede; autenticação não substitui transporte seguro. Para redes não confiáveis, use VPN ou proxy reverso com TLS; nunca exponha PostgreSQL à internet. A proteção de `%ProgramData%` reduz acesso local não autorizado, mas não protege um token enviado em HTTP puro.
