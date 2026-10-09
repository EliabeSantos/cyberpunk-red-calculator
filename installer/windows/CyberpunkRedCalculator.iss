#define AppName "Cyberpunk RED Calculator"
#define AppVersion "0.1.0"
[Setup]
AppId={{B3C4A50A-2E35-4F26-A0B9-4A1C0C0A1A10}
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={autopf}\Cyberpunk RED Calculator
DefaultGroupName={#AppName}
PrivilegesRequired=admin
OutputDir=output
OutputBaseFilename=CyberpunkRedCalculator-Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64
Uninstallable=yes
[Files]
Source: "stage\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion
Source: "..\..\scripts\windows\bootstrap-host.ps1"; DestDir: "{app}\windows"; Flags: ignoreversion
Source: "..\..\scripts\windows\stop-host.ps1"; DestDir: "{app}\windows"; Flags: ignoreversion
Source: "..\..\scripts\windows\open-host.ps1"; DestDir: "{app}\windows"; Flags: ignoreversion
[Icons]
Name: "{group}\Cyberpunk RED Calculator"; Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\windows\bootstrap-host.ps1"""; WorkingDir: "{app}"
Name: "{group}\Abrir Cyberpunk RED Calculator"; Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\windows\open-host.ps1"""; WorkingDir: "{app}"
Name: "{group}\Parar Cyberpunk RED Calculator"; Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\windows\stop-host.ps1"""; WorkingDir: "{app}"
Name: "{userstartup}\Cyberpunk RED Calculator"; Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\windows\bootstrap-host.ps1"""; WorkingDir: "{app}"
[Run]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\windows\bootstrap-host.ps1"""; Flags: postinstall nowait
[UninstallRun]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\scripts\windows\stop-host.ps1"""; Flags: runhidden
