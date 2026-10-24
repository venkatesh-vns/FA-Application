; FA Management System - setup EXE for a new server (built by deploy\package-installers.ps1)
;   makensis /DVERSION=1.2.0 /DKITDIR=<staged kit> /DOUTFILE=<exe> fa-setup.nsi
; Installs the application kit (with its own Node.js) in <folder>\kit, then runs
; deploy\setup-database.ps1 (login, databases, restore of a .backup) and
; deploy\install-new-server.ps1 (settings, application, tables, start, firewall, auto-start).
Unicode true
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!define APPNAME "FA Management System"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\FA-Management"

Name "${APPNAME} ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "C:\FA"
InstallDirRegKey HKLM "${UNINSTKEY}" "InstallLocation"
!ifdef TESTBUILD
  RequestExecutionLevel user          ; test build only (no firewall / auto-start)
  !define SHELLCTX current
!else
  RequestExecutionLevel admin
  !define SHELLCTX all
!endif
ShowInstDetails show
ShowUninstDetails show
BrandingText "${APPNAME} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "FA Management"

Var DbHost
Var DbPort
Var AdminPass
Var AppUser
Var AppPass
Var Backup
Var AppPort
Var DbName
Var OptAutostart
Var OptFirewall
Var OptStaging
Var hHost
Var hPort
Var hAdmin
Var hUser
Var hPass
Var hBackup
Var hAppPort
Var hAuto
Var hFire
Var hStage
Var PS

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "${APPNAME} ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "This sets up ${APPNAME} on this server.$\r$\n$\r$\nBefore you continue:$\r$\n  - PostgreSQL 16 or newer is installed (on this server, or its Command Line Tools here when the database is on another server).$\r$\n  - You know the password of the PostgreSQL user postgres (or the database was prepared with the Database setup EXE).$\r$\n$\r$\nNode.js is included; nothing else is needed."
!insertmacro MUI_PAGE_WELCOME
!define MUI_DIRECTORYPAGE_TEXT_TOP "The application, its settings, logs and backups are kept in this folder."
!insertmacro MUI_PAGE_DIRECTORY
Page custom DatabasePage DatabasePageLeave
Page custom DataPage DataPageLeave
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "${APPNAME} is installed"
!define MUI_FINISHPAGE_TEXT "The application is running.$\r$\n$\r$\nOn this server: http://localhost:$AppPort$\r$\nOn office PCs: http://<this server's name>:$AppPort$\r$\n$\r$\nA new, empty database has the first user admin / admin123: change its password at the first sign-in."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open ${APPNAME} now"
!define MUI_FINISHPAGE_RUN_FUNCTION OpenApp
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

!macro Option NAME VAR
  ClearErrors
  ${GetOptions} $R0 "/${NAME}=" $R1
  ${IfNot} ${Errors}
    StrCpy ${VAR} $R1
  ${EndIf}
!macroend

; Silent installation (scripts, tests):
;   FA-Management-Setup.exe /S [/D=C:\FA] /DBHOST=.. /DBPORT=.. /DBNAME=.. /APPUSER=.. /BACKUP=.. /PORT=..
;                           [/NOAUTOSTART] [/NOFIREWALL] [/NOSTAGING]
;   passwords in the environment variables FA_DB_PASSWORD and FA_PG_ADMIN_PASSWORD (empty: database prepared)

; 64-bit PowerShell (finds PostgreSQL in C:\Program Files) - the setup itself is 32-bit
!macro FindPowerShell
  StrCpy $PS "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
  ${If} ${FileExists} "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    StrCpy $PS "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
!macroend
Function un.onInit
  !insertmacro FindPowerShell
FunctionEnd
Function .onInit
  !insertmacro FindPowerShell
  StrCpy $DbHost "localhost"
  StrCpy $DbPort "5432"
  StrCpy $AppUser "fa_app"
  StrCpy $AppPort "3100"
  StrCpy $DbName "fa_management"
  StrCpy $OptAutostart ${BST_CHECKED}
  StrCpy $OptFirewall ${BST_CHECKED}
  StrCpy $OptStaging ${BST_CHECKED}
  ${If} ${Silent}
    ${GetParameters} $R0
    !insertmacro Option "DBHOST" $DbHost
    !insertmacro Option "DBPORT" $DbPort
    !insertmacro Option "APPUSER" $AppUser
    !insertmacro Option "BACKUP" $Backup
    !insertmacro Option "PORT" $AppPort
    !insertmacro Option "DBNAME" $DbName
    ClearErrors
    ${GetOptions} $R0 "/NOAUTOSTART" $R1
    ${IfNot} ${Errors}
      StrCpy $OptAutostart ${BST_UNCHECKED}
    ${EndIf}
    ClearErrors
    ${GetOptions} $R0 "/NOFIREWALL" $R1
    ${IfNot} ${Errors}
      StrCpy $OptFirewall ${BST_UNCHECKED}
    ${EndIf}
    ClearErrors
    ${GetOptions} $R0 "/NOSTAGING" $R1
    ${IfNot} ${Errors}
      StrCpy $OptStaging ${BST_UNCHECKED}
    ${EndIf}
    ReadEnvStr $AppPass FA_DB_PASSWORD
    ReadEnvStr $AdminPass FA_PG_ADMIN_PASSWORD
    System::Call 'Kernel32::SetEnvironmentVariable(t "FA_SETUP_SILENT", t "1")'
  ${EndIf}
FunctionEnd

; ---------- page: database server
Function DatabasePage
  !insertmacro MUI_HEADER_TEXT "Database" "Where the data is kept (PostgreSQL)"
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 30% 12u "Database server"
  ${NSD_CreateText} 32% 0 40% 12u $DbHost
  Pop $hHost
  ${NSD_CreateLabel} 75% 0 10% 12u "Port"
  ${NSD_CreateNumber} 86% 0 14% 12u $DbPort
  Pop $hPort
  ${NSD_CreateLabel} 0 20u 30% 12u "Password of postgres"
  ${NSD_CreatePassword} 32% 20u 68% 12u $AdminPass
  Pop $hAdmin
  ${NSD_CreateLabel} 32% 34u 68% 20u "Used once to create the application's login and databases. Leave empty when the database was already prepared (Database setup EXE or setup-database.sql)."
  ${NSD_CreateLabel} 0 62u 30% 12u "Application login"
  ${NSD_CreateText} 32% 62u 68% 12u $AppUser
  Pop $hUser
  ${NSD_CreateLabel} 0 80u 30% 12u "Its password"
  ${NSD_CreatePassword} 32% 80u 68% 12u $AppPass
  Pop $hPass
  ${NSD_CreateLabel} 32% 94u 68% 20u "A new, strong password (new login), or the current one if the login exists already."
  nsDialogs::Show
FunctionEnd

Function DatabasePageLeave
  ${NSD_GetText} $hHost $DbHost
  ${NSD_GetText} $hPort $DbPort
  ${NSD_GetText} $hAdmin $AdminPass
  ${NSD_GetText} $hUser $AppUser
  ${NSD_GetText} $hPass $AppPass
  ${If} $DbHost == ""
  ${OrIf} $DbPort == ""
  ${OrIf} $AppUser == ""
    MessageBox MB_ICONEXCLAMATION "Enter the database server, port and application login."
    Abort
  ${EndIf}
  ${If} $AppPass == ""
    MessageBox MB_ICONEXCLAMATION "Enter the password of the application login."
    Abort
  ${EndIf}
FunctionEnd

; ---------- page: existing data + options
Function DataPage
  !insertmacro MUI_HEADER_TEXT "Data and options" "Bring the existing data, or start empty"
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 20u "Existing data: choose the .backup file of the Database kit. Leave empty to keep the data already in the database, or to start with an empty one."
  ${NSD_CreateText} 0 22u 80% 12u $Backup
  Pop $hBackup
  ${NSD_CreateBrowseButton} 82% 21u 18% 14u "Browse..."
  Pop $0
  ${NSD_OnClick} $0 BrowseBackup
  ${NSD_CreateLabel} 0 50u 30% 12u "Application port"
  ${NSD_CreateNumber} 32% 50u 20% 12u $AppPort
  Pop $hAppPort
  ${NSD_CreateCheckbox} 0 72u 100% 12u "Start with Windows, restart if it stops, and keep this server awake (no sleep)"
  Pop $hAuto
  ${NSD_SetState} $hAuto $OptAutostart
  ${NSD_CreateCheckbox} 0 86u 100% 12u "Allow office PCs to open it (Windows Firewall port)"
  Pop $hFire
  ${NSD_SetState} $hFire $OptFirewall
  ${NSD_CreateCheckbox} 0 100u 100% 12u "Also prepare the Staging / UAT copy (port 3300) for testing new versions"
  Pop $hStage
  ${NSD_SetState} $hStage $OptStaging
  nsDialogs::Show
FunctionEnd

Function BrowseBackup
  ${NSD_GetText} $hBackup $1
  nsDialogs::SelectFileDialog open $1 "Database backup (*.backup)|*.backup|All files (*.*)|*.*"
  Pop $1
  ${If} $1 != ""
    ${NSD_SetText} $hBackup $1
  ${EndIf}
FunctionEnd

Function DataPageLeave
  ${NSD_GetText} $hBackup $Backup
  ${NSD_GetText} $hAppPort $AppPort
  ${NSD_GetState} $hAuto $OptAutostart
  ${NSD_GetState} $hFire $OptFirewall
  ${NSD_GetState} $hStage $OptStaging
  ${If} $Backup != ""
  ${AndIfNot} ${FileExists} $Backup
    MessageBox MB_ICONEXCLAMATION "The backup file was not found:$\r$\n$Backup"
    Abort
  ${EndIf}
  ${If} $AppPort == ""
    StrCpy $AppPort "3100"
  ${EndIf}
FunctionEnd

Function OpenApp
  ExecShell "open" "http://localhost:$AppPort"
FunctionEnd

; runs a PowerShell script of the kit in its own window (setup-run.ps1 keeps a log in setup.log).
; ExecWait waits for that window only - nsExec would also wait for the application it starts.
!macro RunScript SCRIPT ARGS
  DetailPrint "Running ${SCRIPT} (see its window; log: $INSTDIR\setup.log)"
  ExecWait '"$PS" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\kit\deploy\setup-run.ps1" -Log "$INSTDIR\setup.log" -Script "$INSTDIR\kit\deploy\${SCRIPT}" ${ARGS}' $0
  ${If} $0 != "0"
    System::Call 'Kernel32::SetEnvironmentVariable(t "FA_DB_PASSWORD", i 0)'
    System::Call 'Kernel32::SetEnvironmentVariable(t "FA_PG_ADMIN_PASSWORD", i 0)'
    DetailPrint "Stopped (code $0). Messages: $INSTDIR\setup.log"
    MessageBox MB_ICONSTOP "The installation stopped. The messages are in$\r$\n$INSTDIR\setup.log$\r$\n$\r$\nCorrect the problem and run the setup again." /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  DetailPrint "${SCRIPT}: done"
!macroend

Section "Install"
  SetShellVarContext ${SHELLCTX}
  SetOutPath "$INSTDIR\kit"
  File /r "${KITDIR}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; passwords reach the scripts through the environment, never on a command line
  StrCpy $6 $AppPass
  System::Call 'Kernel32::SetEnvironmentVariable(t "FA_DB_PASSWORD", t r6)'
  StrCpy $6 $AdminPass
  System::Call 'Kernel32::SetEnvironmentVariable(t "FA_PG_ADMIN_PASSWORD", t r6)'
  StrCpy $6 ""

  StrCpy $1 '-DbHost "$DbHost" -DbPort $DbPort -AppUser "$AppUser" -DbName $DbName'
  ${If} $AdminPass == ""
    StrCpy $1 '$1 -SkipCreate'
  ${EndIf}
  ${If} $Backup != ""
    StrCpy $1 '$1 -RestoreBackup "$Backup"'
  ${EndIf}
  ${If} $AdminPass != ""
  ${OrIf} $Backup != ""
    DetailPrint "Preparing the database..."
    !insertmacro RunScript "setup-database.ps1" $1
  ${EndIf}

  StrCpy $2 '-DbHost "$DbHost" -DbPort $DbPort -DbName $DbName -DbUser "$AppUser" -InstallRoot "$INSTDIR" -Port $AppPort'
  ${If} $OptAutostart == ${BST_CHECKED}
    StrCpy $2 '$2 -Autostart'
  ${EndIf}
  ${If} $OptFirewall == ${BST_CHECKED}
    StrCpy $2 '$2 -OpenFirewall'
  ${EndIf}
  ${If} $OptStaging == ${BST_CHECKED}
    StrCpy $2 '$2 -WithStaging'
  ${EndIf}
  DetailPrint "Installing the application..."
  !insertmacro RunScript "install-new-server.ps1" $2
  ; a server that sleeps is unreachable: power settings, PostgreSQL service, start-up check
  ${If} $OptAutostart == ${BST_CHECKED}
    DetailPrint "Keeping the server awake..."
    !insertmacro RunScript "configure-server.ps1" '-AppFolder "$INSTDIR"'
  ${EndIf}
  System::Call 'Kernel32::SetEnvironmentVariable(t "FA_DB_PASSWORD", i 0)'
  System::Call 'Kernel32::SetEnvironmentVariable(t "FA_PG_ADMIN_PASSWORD", i 0)'

  ; Start menu
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  WriteINIStr "$SMPROGRAMS\${APPNAME}\Open FA Management.url" "InternetShortcut" "URL" "http://localhost:$AppPort"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Start FA Management.lnk" "$INSTDIR\kit\start-app.bat"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Stop FA Management.lnk" "$INSTDIR\kit\stop-app.bat"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Guides.lnk" "$INSTDIR\kit\docs"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Server settings (keep awake).lnk" "$INSTDIR\kit\Configure-Server.bat"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  WriteINIStr "$DESKTOP\FA Management.url" "InternetShortcut" "URL" "http://localhost:$AppPort"

  ; Apps & features
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINSTKEY}" "Publisher" "FA Management"
  WriteRegStr HKLM "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTKEY}" "AppPort" "$AppPort"
  WriteRegStr HKLM "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKLM "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTKEY}" "NoRepair" 1
SectionEnd

; removes the application; the database, the settings (config.env) and the backups are kept
Section "Uninstall"
  SetShellVarContext ${SHELLCTX}
  ReadRegStr $1 HKLM "${UNINSTKEY}" "AppPort"
  ${If} ${FileExists} "$INSTDIR\kit\deploy\env.ps1"
    DetailPrint "Stopping the application..."
    nsExec::ExecToLog '"$PS" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\kit\deploy\install-autostart.ps1" -Env production -Remove'
    nsExec::ExecToLog '"$PS" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\kit\deploy\env.ps1" -Env production -Action stop'
    nsExec::ExecToLog '"$PS" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\kit\deploy\env.ps1" -Env staging -Action stop'
  ${EndIf}
  ${If} $1 != ""
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="FA Management ($1)"'
  ${EndIf}
  ; rd with \\?\ also removes node_modules paths longer than 260 characters
  !macro RemoveTree DIR
    ${If} ${FileExists} "${DIR}\*.*"
      nsExec::Exec 'cmd.exe /c rd /s /q "\\?\${DIR}"'
      RMDir /r "${DIR}"
    ${EndIf}
  !macroend
  !insertmacro RemoveTree "$INSTDIR\kit"
  !insertmacro RemoveTree "$INSTDIR\environments\production\app"
  !insertmacro RemoveTree "$INSTDIR\environments\production\previous"
  !insertmacro RemoveTree "$INSTDIR\environments\staging\app"
  !insertmacro RemoveTree "$INSTDIR\environments\staging\previous"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  Delete "$DESKTOP\FA Management.url"
  DeleteRegKey HKLM "${UNINSTKEY}"
  DetailPrint "Kept: the database, $INSTDIR\environments (settings, logs, backups)."
SectionEnd
