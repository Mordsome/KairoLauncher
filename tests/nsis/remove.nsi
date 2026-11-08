; Runs the uninstaller's careful delete functions (build/kairo-remove.nsh) on
; test folders made by tests/nsis/run.mjs. Never pointed at real folders.
Unicode true
SilentInstall silent
RequestExecutionLevel user
OutFile "${OUT}"
Name "Kairo remove test"

!include "${BUILD}\kairo-remove.nsh"
!insertmacro KAIRO_REMOVE_FUNCTIONS ""

Section
  Push "${ROOT}\data"
  Call kairoEmptyDataFolder
  Push "${ROOT}\cache"
  Call kairoRemoveTree
  Push "${ROOT}\cache-link"
  Call kairoRemoveTree
SectionEnd
