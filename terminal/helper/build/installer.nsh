; VibeCodes helper, Windows installer extras (card 51d424f7, release 1b).
;
; Installing registers the vibecodes:// link handler for this user, so links
; work straight after a silent install, before the app's first start.
; electron-builder's `protocols` setting only reaches the Mac app, so this
; writes the same three values Electron's setAsDefaultProtocolClient writes
; (the app still rewrites them at every start, which repairs the key).
;
; Uninstalling removes what the helper itself wrote to the user's registry:
; the vibecodes:// link handler and the start-at-login entry. An update runs
; the old uninstaller first, so skip this then: the new version keeps both.
; The saved sign-in in AppData is kept (deleteAppDataOnUninstall: false).

!macro customInstall
  WriteRegStr HKCU "Software\Classes\vibecodes" "" "URL:vibecodes"
  WriteRegStr HKCU "Software\Classes\vibecodes" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\vibecodes\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\vibecodes"
    ; Electron names the start-at-login entry after the app's id; older
    ; Electron builds used electron.app.<productName>.
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "co.uk.vibecodes.helper"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.VibeCodes"
  ${endIf}
!macroend
