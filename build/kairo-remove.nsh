; Careful deleting for the uninstaller, kept apart so tests/nsis can run it on
; test folders. Links (junctions, symbolic links) are removed themselves and
; never followed, so nothing they point to is touched.
;
; !insertmacro KAIRO_REMOVE_FUNCTIONS "un." makes un.kairoRemoveTree and
; un.kairoEmptyDataFolder; "" makes the same for a test.

!include LogicLib.nsh
!include FileFunc.nsh

!macro KAIRO_REMOVE_FUNCTIONS PREFIX

; Deletes a folder and what's in it. The folder is on the stack.
Function ${PREFIX}kairoRemoveTree
  Exch $R0 ; the folder
  Push $R1
  Push $R2
  Push $R3

  ${GetFileAttributes} "$R0" "REPARSE_POINT" $R3
  ${If} $R3 == "1"
    RMDir "$R0" ; the link only
    Goto end
  ${EndIf}

  FindFirst $R1 $R2 "$R0\*.*"
  loop:
    StrCmp $R2 "" done
    StrCmp $R2 "." next
    StrCmp $R2 ".." next
    ${GetFileAttributes} "$R0\$R2" "REPARSE_POINT" $R3
    StrCmp $R3 "1" link
    ${GetFileAttributes} "$R0\$R2" "DIRECTORY" $R3
    StrCmp $R3 "1" folder
    Delete "$R0\$R2"
    Goto next
  link:
    ; RMDir without /r removes a folder link itself; Delete removes a file link itself.
    RMDir "$R0\$R2"
    Delete "$R0\$R2"
    Goto next
  folder:
    Push "$R0\$R2"
    Call ${PREFIX}kairoRemoveTree
  next:
    FindNext $R1 $R2
    Goto loop
  done:
  FindClose $R1
  RMDir "$R0" ; without /r: only once it's empty

  end:
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd

; Empties the launcher's data folder (on the stack), except its "backups"
; folder (the copy of .minecraft). The folder itself goes if nothing is left.
Function ${PREFIX}kairoEmptyDataFolder
  Exch $R0
  Push $R1
  Push $R2
  Push $R3

  StrLen $R3 "$R0"
  ${If} $R3 < 8
  ${OrIfNot} ${FileExists} "$R0\*.*"
    Goto end
  ${EndIf}
  ${GetFileAttributes} "$R0" "REPARSE_POINT" $R3
  ${If} $R3 == "1"
    RMDir "$R0" ; a link: remove the link, not what it points to
    Goto end
  ${EndIf}

  FindFirst $R1 $R2 "$R0\*.*"
  loop:
    StrCmp $R2 "" done
    StrCmp $R2 "." next
    StrCmp $R2 ".." next
    StrCmp $R2 "backups" next
    ${GetFileAttributes} "$R0\$R2" "DIRECTORY" $R3
    ${If} $R3 == "1"
      Push "$R0\$R2"
      Call ${PREFIX}kairoRemoveTree
    ${Else}
      Delete "$R0\$R2"
    ${EndIf}
  next:
    FindNext $R1 $R2
    Goto loop
  done:
  FindClose $R1
  RMDir "$R0" ; stays if the backups folder is in it

  end:
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd

!macroend
