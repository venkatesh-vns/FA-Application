; FA Management System - database setup EXE (built by deploy\package-installers.ps1)
;   makensis /DVERSION=1.2.0 /DBACKUP=<file.backup> /DSCRIPT=<setup-database.ps1> /DOUTFILE=<exe> fa-database.nsi
; Run on the database server: creates the application's login and databases and restores the
; production data contained in this EXE (or another .backup chosen on the page).
; Nothing is installed permanently; the files are unpacked to a temporary folder.
Unicode true
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!define APPNAME "FA Management System"
Name "${APPNAME} ${VERSION} - Database"
OutFile "${OUTFILE}"
RequestExecutionLevel user                ; only signs in to PostgreSQL; nothing on this PC changes
ShowInstDetails show
BrandingText "${APPNAME} ${VERSION} - Database setup"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} database setup and restore"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "FA Management"

Var DbHost
Var DbPort
Var AdminPass
Var AppUser
Var AppPass
Var Backup
Var Mode
Var DbName
Var hHost
Var hPort
Var hAdmin
Var hUser
Var hPass
Var hBackup
Var hData
Var hEmpty

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "${APPNAME} ${VERSION} - Database"
!define MUI_WELCOMEPAGE_TEXT "Run this on the database server (PostgreSQL 16 or newer installed).$\r$\n$\r$\nIt creates the application's login and the databases fa_management, fa_management_staging and fa_management_archive, and restores the existing data:$\r$\n  ${BACKUPINFO}$\r$\n$\r$\nThe data is restored only into a new, empty database; an existing database is never overwritten.$\r$\n$\r$\nAfterwards run the FA Management Setup EXE on the application server."
!insertmacro MUI_PAGE_WELCOME
Page custom DatabasePage DatabasePageLeave
Page custom DataPage DataPageLeave
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "The database is ready"
!define MUI_FINISHPAGE_TEXT "Next: on the application server run FA-Management-Setup-${VERSION}.exe with the same database server, application login and password, and leave its backup file empty (the data is here already).$\r$\n$\r$\nDatabase on another server than the application: allow the application server in pg_hba.conf and open port $DbPort (see the Installation Guide)."
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "English"

!macro Option NAME VAR
  ClearErrors
  ${GetOptions} $R0 "/${NAME}=" $R1
  ${IfNot} ${Errors}
    StrCpy ${VAR} $R1
  ${EndIf}
!macroend

; Silent:  FA-Management-Database.exe /S [/DBHOST=..] [/DBPORT=..] [/APPUSER=..] [/DBNAME=..] [/BACKUP=<file> | /EMPTY]
;          passwords in FA_PG_ADMIN_PASSWORD and FA_DB_PASSWORD; result in the exit code
Function .onInit
  StrCpy $DbHost "localhost"
  StrCpy $DbPort "5432"
  StrCpy $AppUser "fa_app"
  StrCpy $DbName "fa_management"
  StrCpy $Mode "data"
  ${If} ${Silent}
    ${GetParameters} $R0
    !insertmacro Option "DBHOST" $DbHost
    !insertmacro Option "DBPORT" $DbPort
    !insertmacro Option "APPUSER" $AppUser
    !insertmacro Option "DBNAME" $DbName
    !insertmacro Option "BACKUP" $Backup
    ${If} $Backup != ""
      StrCpy $Mode "file"
    ${EndIf}
    ClearErrors
    ${GetOptions} $R0 "/EMPTY" $R1
    ${IfNot} ${Errors}
      StrCpy $Mode "empty"
    ${EndIf}
    ReadEnvStr $AppPass FA_DB_PASSWORD
    ReadEnvStr $AdminPass FA_PG_ADMIN_PASSWORD
    System::Call 'Kernel32::SetEnvironmentVariable(t "FA_SETUP_SILENT", t "1")'
  ${EndIf}
FunctionEnd

Function DatabasePage
  !insertmacro MUI_HEADER_TEXT "Database server" "PostgreSQL on this server"
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
  ${NSD_CreateLabel} 32% 34u 68% 12u "The PostgreSQL superuser chosen when PostgreSQL was installed."
  ${NSD_CreateLabel} 0 56u 30% 12u "Application login"
  ${NSD_CreateText} 32% 56u 68% 12u $AppUser
  Pop $hUser
  ${NSD_CreateLabel} 0 74u 30% 12u "Its password"
  ${NSD_CreatePassword} 32% 74u 68% 12u $AppPass
  Pop $hPass
  ${NSD_CreateLabel} 32% 88u 68% 28u "Choose a new, strong password (or the current one if the login exists). Use the same login and password in the application Setup EXE."
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
  ${OrIf} $AdminPass == ""
  ${OrIf} $AppPass == ""
    MessageBox MB_ICONEXCLAMATION "Fill in every field."
    Abort
  ${EndIf}
FunctionEnd

Function DataPage
  !insertmacro MUI_HEADER_TEXT "Data" "What goes into fa_management"
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateRadioButton} 0 0 100% 12u "Restore the production data included in this file (${BACKUPINFO})"
  Pop $hData
  ${NSD_CreateRadioButton} 0 18u 100% 12u "Restore another .backup file:"
  Pop $1
  ${NSD_CreateText} 12u 34u 70% 12u $Backup
  Pop $hBackup
  ${NSD_CreateBrowseButton} 82% 33u 18% 14u "Browse..."
  Pop $0
  ${NSD_OnClick} $0 BrowseBackup
  ${NSD_CreateRadioButton} 0 58u 100% 12u "No data: an empty database (the application creates the tables and a first admin)"
  Pop $hEmpty
  ${If} $Mode == "empty"
    ${NSD_Check} $hEmpty
  ${ElseIf} $Mode == "file"
    ${NSD_Check} $1
  ${Else}
    ${NSD_Check} $hData
  ${EndIf}
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
  ${NSD_GetState} $hData $0
  ${NSD_GetState} $hEmpty $1
  ${If} $0 == ${BST_CHECKED}
    StrCpy $Mode "data"
  ${ElseIf} $1 == ${BST_CHECKED}
    StrCpy $Mode "empty"
  ${Else}
    StrCpy $Mode "file"
    ${IfNot} ${FileExists} $Backup
      MessageBox MB_ICONEXCLAMATION "Choose an existing .backup file."
      Abort
    ${EndIf}
  ${EndIf}
FunctionEnd

Section "Database"
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\fa"
  File "/oname=setup-database.ps1" "${SCRIPT}"
  File "/oname=setup-run.ps1" "${RUNNER}"
  ${If} $Mode == "data"
    File "/oname=data.backup" "${BACKUP}"
    StrCpy $Backup "$PLUGINSDIR\fa\data.backup"
  ${EndIf}
  StrCpy $6 $AppPass
  System::Call 'Kernel32::SetEnvironmentVariable(t "FA_DB_PASSWORD", t r6)'
  StrCpy $6 $AdminPass
  System::Call 'Kernel32::SetEnvironmentVariable(t "FA_PG_ADMIN_PASSWORD", t r6)'
  StrCpy $6 ""
  StrCpy $1 '-DbHost "$DbHost" -DbPort $DbPort -AppUser "$AppUser" -DbName $DbName'
  ${If} $Mode != "empty"
    StrCpy $1 '$1 -RestoreBackup "$Backup"'
  ${EndIf}
  StrCpy $7 "$DOCUMENTS\FA-Management-database-setup.log"
  DetailPrint "Preparing the database (see its window; log: $7)"
  ; 64-bit PowerShell (finds PostgreSQL in C:\Program Files); the window shows the progress
  StrCpy $8 "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
  ${If} ${FileExists} "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    StrCpy $8 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
  ExecWait '"$8" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\fa\setup-run.ps1" -Log "$7" -Script "$PLUGINSDIR\fa\setup-database.ps1" $1' $0
  System::Call 'Kernel32::SetEnvironmentVariable(t "FA_DB_PASSWORD", i 0)'
  System::Call 'Kernel32::SetEnvironmentVariable(t "FA_PG_ADMIN_PASSWORD", i 0)'
  SetOutPath "$TEMP"
  ${If} $0 != "0"
    DetailPrint "Stopped (code $0). Messages: $7"
    MessageBox MB_ICONSTOP "The database setup stopped. The messages are in$\r$\n$7$\r$\n$\r$\nCorrect the problem and run this again." /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
SectionEnd
