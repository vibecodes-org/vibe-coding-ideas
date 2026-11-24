; VibeCodes helper, Windows installer extras (card 51d424f7, release 1b).
;
; Uninstalling removes what the helper itself wrote to the user's registry:
; the vibecodes:// link handler and the start-at-login entry. An update runs
; the old uninstaller first, so skip this then: the new version keeps both.
; The saved sign-in in AppData is kept (deleteAppDataOnUninstall: false).

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\vibecodes"
    ; Electron names the start-at-login entry after the app's id; older
    ; Electron builds used electron.app.<productName>.
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "co.uk.vibecodes.helper"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.VibeCodes"
  ${endIf}
!macroend
