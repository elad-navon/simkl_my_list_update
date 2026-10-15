' Starts the Emby bridge in the background, with no window. A shortcut to
' this file in the Windows Startup folder runs it at every sign-in; its
' output goes to emby-bridge.log next to it.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = here
shell.Run "node """ & here & "\run.js""", 0, False
