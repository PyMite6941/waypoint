# Builds waypoint-presenter.jar on Windows. Needs a JDK 17 or newer; nothing else.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (Test-Path out) { Remove-Item -Recurse -Force out }
# Relative paths: Windows PowerShell passes full paths to javac in the ANSI code page,
# which breaks folders with non-ASCII names (for example a Japanese Documents folder).
javac --release 17 -d out (Get-ChildItem src/waypoint/*.java | ForEach-Object { "src/waypoint/$($_.Name)" })
jar --create --file waypoint-presenter.jar --main-class waypoint.Main -C out .
Write-Output 'Built java\waypoint-presenter.jar. Run: java -jar java\waypoint-presenter.jar [deck.waypoint.json]'
