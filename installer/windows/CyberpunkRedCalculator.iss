#define AppName "Cyberpunk RED Calculator"
#define AppVersion "0.1.2"
[Setup]
AppId={{B3C4A50A-2E35-4F26-A0B9-4A1C0C0A1A10}
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={autopf}\Cyberpunk RED Calculator
DefaultGroupName={#AppName}
PrivilegesRequired=admin
OutputDir=output
OutputBaseFilename=CyberpunkRedCalculator-Setup
SetupIconFile=..\..\src\app\icon.ico
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64
Uninstallable=yes
UninstallDisplayIcon={app}\app\icon.ico
[Files]
Source: "stage\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion
Source: "..\..\scripts\windows\bootstrap-host.ps1"; DestDir: "{app}\windows"; Flags: ignoreversion
Source: "..\..\scripts\windows\stop-host.ps1"; DestDir: "{app}\windows"; Flags: ignoreversion
Source: "..\..\scripts\windows\open-host.ps1"; DestDir: "{app}\windows"; Flags: ignoreversion
[Icons]
Name: "{group}\Cyberpunk RED Calculator"; Filename: "{app}\app\node_modules\electron\dist\electron.exe"; Parameters: """{app}\app\desktop\main.cjs"""; WorkingDir: "{app}\app"; IconFilename: "{app}\app\icon.ico"
Name: "{commondesktop}\Cyberpunk RED Calculator"; Filename: "{app}\app\node_modules\electron\dist\electron.exe"; Parameters: """{app}\app\desktop\main.cjs"""; WorkingDir: "{app}\app"; IconFilename: "{app}\app\icon.ico"
Name: "{group}\Abrir Cyberpunk RED Calculator"; Filename: "{app}\app\node_modules\electron\dist\electron.exe"; Parameters: """{app}\app\desktop\main.cjs"""; WorkingDir: "{app}\app"; IconFilename: "{app}\app\icon.ico"
Name: "{group}\Parar Cyberpunk RED Calculator"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\windows\stop-host.ps1"""; WorkingDir: "{app}"
Name: "{userstartup}\Cyberpunk RED Calculator"; Filename: "{app}\app\node_modules\electron\dist\electron.exe"; Parameters: """{app}\app\desktop\main.cjs"""; WorkingDir: "{app}\app"; IconFilename: "{app}\app\icon.ico"
[Run]
Filename: "{app}\app\node_modules\electron\dist\electron.exe"; Parameters: """{app}\app\desktop\main.cjs"""; WorkingDir: "{app}\app"; Flags: postinstall nowait
[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\windows\stop-host.ps1"""; Flags: runhidden
[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
  StopScript: String;
  Params: String;
begin
  Result := '';
  StopScript := ExpandConstant('{app}\windows\stop-host.ps1');
  if not FileExists(StopScript) then Exit;
  Params := '-NoProfile -ExecutionPolicy Bypass -File "' + StopScript + '"';
  if (not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Params,
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ExitCode)) or (ExitCode <> 0) then
    Result := 'Não foi possível parar a versão anterior. A atualização foi abortada; consulte %ProgramData%\Cyberpunk RED Calculator\logs.';
end;
