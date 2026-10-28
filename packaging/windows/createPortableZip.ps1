param(
    [Parameter(Mandatory = $true)][string]$SourceDirectory,
    [Parameter(Mandatory = $true)][string]$ArchivePath
)

# Creates a ZIP with standard slash-separated paths and validates its distributable contents.
$SourceDirectory = [System.IO.Path]::GetFullPath($SourceDirectory)
$ArchivePath = [System.IO.Path]::GetFullPath($ArchivePath)
$readmePath = Join-Path $SourceDirectory 'README-KTV.txt'
if (-not (Test-Path -LiteralPath $readmePath)) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README-PORTABLE.txt') -Destination $readmePath
}
Get-ChildItem -LiteralPath $SourceDirectory -File -Filter '*.txt' |
    Where-Object { $_.Name -notin @('README-KTV.txt', 'LICENSE-Folia.txt', 'LICENSE.electron.txt') } |
    Remove-Item -Force
if (Test-Path -LiteralPath $ArchivePath) {
    Remove-Item -LiteralPath $ArchivePath -Force
}
$checksumPath = "$ArchivePath.sha256"
if (Test-Path -LiteralPath $checksumPath) {
    Remove-Item -LiteralPath $checksumPath -Force
}
$root = [System.IO.Path]::GetFileName($SourceDirectory)
& tar.exe -a -c -f $ArchivePath -C (Split-Path -Parent $SourceDirectory) $root
if ($LASTEXITCODE -ne 0) {
    throw "ZIP creation failed with tar exit code $LASTEXITCODE"
}
$archiveEntries = @(& tar.exe -tf $ArchivePath)
if ($LASTEXITCODE -ne 0) {
    throw "ZIP listing check failed with tar exit code $LASTEXITCODE"
}
$required = @(
    "$root/Folia-KTV.exe",
    "$root/README-KTV.txt",
    "$root/resources/models/htdemucs-wgsl.bin",
    "$root/resources/models/beat_this-wgsl.bin",
    "$root/resources/mnn/folia_mnn.dll",
    "$root/resources/ffmpeg-audio/ffmpeg.exe"
)
foreach ($entry in $required) {
    if ($entry -notin $archiveEntries) {
        throw "Portable archive is missing $entry"
    }
}
Write-Output "[Portable] Verified archive $ArchivePath ($($archiveEntries.Count) required entries verified)"
