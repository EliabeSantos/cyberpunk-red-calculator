# Self-host local no Windows

O modo local é explícito: `MESA_HOSTING_MODE=local` e PostgreSQL local. Os jogadores acessam somente o Next.js; a porta do PostgreSQL fica em `127.0.0.1`.

## Instalação

O artefato reproduzível fica em `installer/windows/CyberpunkRedCalculator.iss`.
Ele empacota Node.js, PostgreSQL e o build do aplicativo. A pessoa que prepara o artefato executa `scripts/windows/build-installer.ps1` em uma máquina Windows com Inno Setup. O instalador final não exige Node.js, PostgreSQL ou edição manual de variáveis.

Requisitos para montar o instalador: Windows x64, Node/npm apenas na máquina de build, Inno Setup 6 e acesso para baixar os pacotes oficiais de Node.js e PostgreSQL. A máquina do usuário final precisa apenas executar o instalador como administrador.

As versões e hashes SHA-256 dos runtimes estão em `installer/windows/RUNTIME-MANIFEST.md`; o script de build recusa qualquer arquivo baixado que não corresponda ao hash fixado. Inno Setup é necessário somente na máquina de build. Os avisos/licenças distribuídos nos arquivos oficiais de Node.js e PostgreSQL permanecem no pacote.

Na primeira execução, o bootstrap cria um cluster em `%ProgramData%\Cyberpunk RED Calculator\postgres`, uma configuração protegida e aplica todas as migrations. O instalador também cria um atalho de inicialização automática; após reiniciar o Windows, PostgreSQL e o servidor são recuperados pelo mesmo bootstrap. Não copie essa pasta para chats ou repositórios.

O atalho **Cyberpunk RED Calculator** inicia o host e abre `http://localhost:3000`. O primeiro GM cria o usuário/mesa pela interface; não há usuário ou senha de aplicação padrão. Se a porta 5432 ou 3000 estiver ocupada, o bootstrap interrompe com erro e grava o diagnóstico em `%ProgramData%\Cyberpunk RED Calculator\logs`.

O grupo de atalhos também inclui **Abrir** e **Parar**. O atalho de parada encerra somente o processo do host registrado pelo bootstrap e o cluster PostgreSQL deste aplicativo; não encerra processos desconhecidos que usem as mesmas portas.

## Uso e rede

1. Execute o atalho **Cyberpunk RED Calculator** como host.
2. Abra `http://localhost:3000` e crie a mesa.
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

O instalador não remove `%ProgramData%\Cyberpunk RED Calculator`; atualizar preserva mesas, personagens e histórico. Use `scripts/backup-local.mjs` com `pg_dump` antes de atualizar:

```powershell
$env:MESA_LOCAL_DATABASE_URL = "postgresql://mesa_app:<senha>@127.0.0.1:5432/cyberpunk_red"
node scripts/backup-local.mjs C:\Backups\mesa-2026-10-09.dump
```

Crie um banco/cluster separado e restaure nele com `scripts/restore-local.mjs` e `pg_restore`. O restore recusa destinos não vazios por padrão; para uma substituição deliberada, use `--allow-overwrite` junto de `MESA_RESTORE_CONFIRM=I_UNDERSTAND`, depois valide a mesa restaurada antes de apontar o host para ela. Migrations já aplicadas são verificadas por checksum; uma alteração manual é recusada. A correção de Cover Damage possui migration posterior e o migrador local aceita somente o checksum legado conhecido dessa migration específica.

Em falha, consulte `%ProgramData%\Cyberpunk RED Calculator\logs`, confirme o processo PostgreSQL e execute o bootstrap novamente. O backup deve ser restaurado em uma instância/banco separado: `restore-local.mjs` recusa destinos não vazios por padrão. Para uma substituição deliberada, use `--allow-overwrite` junto de `MESA_RESTORE_CONFIRM=I_UNDERSTAND`, depois valide a mesa restaurada antes de apontar o host para ela. Desinstalar remove o programa e preserva os dados por padrão.

Problemas comuns:

* **Porta ocupada:** encerre o processo identificado por `Get-NetTCPConnection -LocalPort 3000` ou `5432`; não altere a porta no banco sem atualizar `host.env`.
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

Não há TLS embutido. Para redes não confiáveis, use VPN ou proxy reverso com TLS; nunca exponha PostgreSQL à internet.
