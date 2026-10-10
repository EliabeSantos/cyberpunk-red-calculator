# Atualização automática no Windows

## Formato compatível

O atualizador usa `electron-updater` com o provedor GitHub configurado no
`package.json`. O artefato compatível é o instalador **NSIS gerado pelo
electron-builder**, junto com o `latest.yml` e os arquivos de atualização
gerados para a versão.

O `CyberpunkRedCalculator-Setup.exe` produzido pelo Inno Setup continua sendo
um instalador legado/manual. Ele empacota um Electron executado diretamente a
partir de `app\node_modules` e não deve ser o artefato usado para testar
atualização automática do `electron-updater`. Para releases com atualização
automática, distribua o `*Setup.exe` de `installer/windows/electron-output`.

## Publicar uma versão

1. Atualize `version` em `package.json` para uma versão semver maior que a
   publicada anteriormente. Atualize também `installer/windows/CyberpunkRedCalculator.iss`
   se o instalador legado continuar sendo gerado.
2. Gere a build Windows no ambiente com Node, PostgreSQL portátil e Inno Setup:

   ```powershell
   .\scripts\windows\build-installer.ps1
   ```

   Esse script usa `--publish never` e não publica nada automaticamente. O
   instalador NSIS compatível fica em `installer/windows/electron-output`.
3. Crie uma GitHub Release com uma tag igual à versão, por exemplo `v0.2.0`.
4. Anexe o instalador NSIS e os metadados/artefatos de atualização produzidos
   pelo electron-builder (`latest.yml` e o arquivo `.blockmap`, quando gerado).
   Não anexe credenciais. Se a publicação for automatizada pelo
   electron-builder, forneça `GH_TOKEN` somente como variável secreta do runner.

O instalador já instalado lê `app-update.yml` gerado pelo electron-builder,
consulta o GitHub Releases periodicamente e valida o pacote conforme os
mecanismos de assinatura/checksum do electron-builder. O aplicativo não baixa
nem executa instaladores de URLs arbitrárias.

## Experiência no aplicativo

- A verificação ocorre na abertura e a cada seis horas.
- Uma nova versão gera uma notificação com a opção **Baixar agora** ou
  **Depois**.
- O download é confirmado pelo usuário, ocorre em segundo plano e mostra o
  progresso no título, na barra de tarefas e no menu `Ajuda > Atualizações`.
- Após o download, o usuário escolhe **Reiniciar e instalar** ou adiar.
- A instalação só chama `quitAndInstall` depois que o host local é encerrado
  com o script validado de parada.

## Dados locais e diagnóstico

O atualizador não usa nem remove o diretório de dados do aplicativo. O
PostgreSQL local, o banco `cyberpunk_red`, `host.env`, tokens e configurações
continuam em `%ProgramData%\Cyberpunk RED Calculator` (ou no `MESA_DATA_DIR`
configurado). Migrations não são aplicadas pelo instalador de atualização.

Os eventos do atualizador ficam em:

```text
%ProgramData%\Cyberpunk RED Calculator\logs\updater.log
```

Os logs do host e do PostgreSQL continuam nos arquivos existentes no mesmo
diretório. Falhas de internet, download ou instalação mantêm a versão atual
funcionando e podem ser repetidas pelo menu de atualizações.

## Limitações de validação

O ambiente de desenvolvimento não possui uma instalação Windows empacotada nem
uma GitHub Release de teste. Portanto, a troca real entre duas versões, a
assinatura do artefato e a execução do instalador NSIS precisam ser validadas
em um Windows limpo antes da primeira distribuição pública.
