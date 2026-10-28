Option Explicit

Dim fileSystem, shell, projectDir, logDir, batchPath, logPath, command
Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

projectDir = fileSystem.GetParentFolderName(WScript.ScriptFullName)
logDir = fileSystem.BuildPath(projectDir, "logs")
If Not fileSystem.FolderExists(logDir) Then fileSystem.CreateFolder(logDir)

batchPath = fileSystem.BuildPath(projectDir, "start-ktv.bat")
logPath = fileSystem.BuildPath(logDir, "ktv-launch.log")
shell.Environment("PROCESS")("FOLIA_KTV_LAUNCH") = "true"
command = "cmd.exe /d /c call """ & batchPath & """ > """ & logPath & """ 2>&1"
shell.Run command, 0, False
