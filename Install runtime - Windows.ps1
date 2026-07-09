param([switch]$NoPrompt)
$ErrorActionPreference = "Stop"
$BaseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$NodeVersion = "20.18.1"
$UrlBase = "https://nodejs.org/dist/v$NodeVersion"
$File = "node-v$NodeVersion-win-x64.zip"
$Work = Join-Path $BaseDir "runtime\.download-win-x64"
$Target = Join-Path $BaseDir "runtime\win-x64"
New-Item -ItemType Directory -Force -Path $Work | Out-Null
New-Item -ItemType Directory -Force -Path $Target | Out-Null
Write-Host "Installing Node.js $NodeVersion for Windows x64"
Write-Host "This requires internet access for the first run only."
$ShaFile = Join-Path $Work "SHASUMS256.txt"
$ZipFile = Join-Path $Work $File
Invoke-WebRequest -Uri "$UrlBase/SHASUMS256.txt" -OutFile $ShaFile
Invoke-WebRequest -Uri "$UrlBase/$File" -OutFile $ZipFile
$Expected = (Select-String -Path $ShaFile -Pattern " $File$").Line.Split(' ')[0]
$Actual = (Get-FileHash -Algorithm SHA256 $ZipFile).Hash.ToLower()
if (!$Expected -or $Expected.ToLower() -ne $Actual) { throw "Checksum verification failed. Runtime was not installed." }
Remove-Item -Recurse -Force $Target -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Target | Out-Null
Expand-Archive -Force -Path $ZipFile -DestinationPath $Work
$Extracted = Get-ChildItem $Work -Directory | Where-Object { $_.Name -like "node-v$NodeVersion-win-x64*" } | Select-Object -First 1
if (!$Extracted) { throw "Extracted runtime folder was not found." }
Copy-Item -Recurse -Force (Join-Path $Extracted.FullName "*") $Target
Write-Host "Runtime installed: $(Join-Path $Target 'node.exe')"
if (!$NoPrompt) { Read-Host "Press Enter to close" }
