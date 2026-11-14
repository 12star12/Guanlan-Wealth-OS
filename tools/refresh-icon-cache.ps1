$ErrorActionPreference = 'Continue'

$charGuan = [char]0x89C2   # guan
$charLan  = [char]0x6F9C   # lan
$lnkName  = "$charGuan$charLan.lnk"

$desktop = [Environment]::GetFolderPath('Desktop')
$lnk     = Join-Path $desktop $lnkName
$want    = 'D:\Guanlan-Wealth-OS\assets\guanlan-boat.ico'

"desktop   : $desktop"
"lnk       : $lnk"
"lnk exist : $(Test-Path -LiteralPath $lnk)"

if (Test-Path -LiteralPath $lnk) {
  $sh = New-Object -ComObject WScript.Shell
  $sc = $sh.CreateShortcut($lnk)
  "target    : $($sc.TargetPath)"
  "arguments : $($sc.Arguments)"
  "iconfield : $($sc.IconLocation)"
}

"want ico  : $(Test-Path -LiteralPath $want)"
"ico mtime : $((Get-Item -LiteralPath $want).LastWriteTime)"

# --- rebuild icon cache ---
$exDir = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Explorer'
"cache dir : $exDir  (exists=$(Test-Path -LiteralPath $exDir))"

$all = @()
if (Test-Path -LiteralPath $exDir) {
  $all = Get-ChildItem -LiteralPath $exDir -Force -File -ErrorAction SilentlyContinue |
         Where-Object { $_.Name -like 'iconcache_*.db' -or $_.Name -like 'thumbcache_*.db' }
}
"cache files: $($all.Count)  -> $((($all | Select-Object -First 6).Name) -join ', ')"

"stopping explorer..."
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$removed = 0
foreach ($f in $all) {
  try { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop; $removed++ }
  catch { "  skip $($f.Name)" }
}
"removed $removed / $($all.Count)"

# --- always bring explorer back ---
if (-not (Get-Process explorer -ErrorAction SilentlyContinue)) {
  Start-Process 'explorer.exe'
}
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 400
  if (Get-Process explorer -ErrorAction SilentlyContinue) { break }
}
$p = Get-Process explorer -ErrorAction SilentlyContinue
"explorer  : running=$([bool]$p) pid=$(($p | ForEach-Object { $_.Id }) -join ',')"

if (Test-Path 'C:\Windows\System32\ie4uinit.exe') {
  & 'C:\Windows\System32\ie4uinit.exe' -show 2>$null
  "ie4uinit  : -show issued"
}
"done"
