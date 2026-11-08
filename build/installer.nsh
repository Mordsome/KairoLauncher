; Kairo Launcher's own uninstall steps (electron-builder includes this file).
;
; Safety rules:
; - The install folder is never deleted with a recursive delete. Only the files
;   this installer put there are removed, by name (the list is made from the
;   packaged app at build time). If someone installed into a folder that holds
;   other things, those things stay.
; - Nothing is removed unless the launcher's own .exe is in that folder.
; - The player's data is kept unless they say yes to deleting it, and even
;   then only the launcher's own data folder is emptied (build/kairo-remove.nsh,
;   tested by tests/nsis). Links are never followed. The .minecraft folder, and
;   the launcher's backup of it, are never deleted.

!include LogicLib.nsh
!include "${BUILD_RESOURCES_DIR}\kairo-remove.nsh"

; Made by scripts/after-pack.cjs: the kairoRemoveAppFiles macro.
!include "${BUILD_RESOURCES_DIR}\uninstall-files.nsh"

!define KAIRO_DATA_NAME "Kairo Launcher"
!define KAIRO_UPDATER_CACHE "kairo-launcher-updater"

!macro customRemoveFiles
  SetOutPath $TEMP
  ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ; Added to the app by electron-builder after the list is made.
    Delete "$INSTDIR\resources\elevate.exe"
    !insertmacro kairoRemoveAppFiles
    Delete "$INSTDIR\${UNINSTALL_FILENAME}"
    Delete "$INSTDIR\uninstallerIcon.ico"
    ; Removed only if nothing else is left in it.
    RMDir "$INSTDIR"
  ${Else}
    DetailPrint "Kairo Launcher isn't in $INSTDIR, so no files were removed there."
  ${EndIf}
!macroend

!macro customUnInstall
  ; Asked only when the player uninstalls, never during an update or a silent uninstall.
  ${IfNot} ${isUpdated}
  ${AndIfNot} ${Silent}
    ${If} ${Cmd} `MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete Kairo Launcher's data?$\r$\n$\r$\nYes deletes the installs made in the launcher (their worlds, mods and settings), the launcher's settings and its sign-ins.$\r$\n$\r$\nNo keeps them, so installing the launcher again picks up where you left off.$\r$\n$\r$\nYour .minecraft folder, and the launcher's backup of it, are never deleted." IDYES`
      Call un.kairoRemoveData
    ${EndIf}
  ${EndIf}
!macroend

!ifdef BUILD_UNINSTALLER

!insertmacro KAIRO_REMOVE_FUNCTIONS "un."

; The launcher's data folder (minus backups), its update cache and its sign-ins.
Function un.kairoRemoveData
  Push $R0
  SetShellVarContext current

  StrLen $R0 "$APPDATA"
  ${If} $R0 >= 4
    Push "$APPDATA\${KAIRO_DATA_NAME}"
    Call un.kairoEmptyDataFolder
  ${EndIf}

  StrLen $R0 "$LOCALAPPDATA"
  ${If} $R0 >= 4
  ${AndIf} ${FileExists} "$LOCALAPPDATA\${KAIRO_UPDATER_CACHE}\*.*"
    Push "$LOCALAPPDATA\${KAIRO_UPDATER_CACHE}"
    Call un.kairoRemoveTree
  ${EndIf}

  ; Only Credential Manager entries named "<key>.KairoLauncher".
  InitPluginsDir
  File "/oname=$PLUGINSDIR\forget-sign-ins.ps1" "${BUILD_RESOURCES_DIR}\forget-sign-ins.ps1"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\forget-sign-ins.ps1"'
  Pop $R0

  Pop $R0
FunctionEnd

!endif
