$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root   = 'D:\Guanlan-Wealth-OS'
$assets = Join-Path $root 'assets'
if (-not (Test-Path $assets)) { New-Item -ItemType Directory -Path $assets | Out-Null }
$icoPath = Join-Path $assets 'guanlan.ico'

# 中文用字符码，避免脚本文件编码问题
$charGuan = [char]0x89C2    # 观
$charLan  = [char]0x6F9C    # 澜
$charDot  = [char]0x00B7    # ·

$ink   = [System.Drawing.Color]::FromArgb(43, 38, 32)
$paper = [System.Drawing.Color]::FromArgb(242, 234, 216)
$red   = [System.Drawing.Color]::FromArgb(178, 58, 46)

function New-IconPng([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap -ArgumentList $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear($ink)

  # 印章内框：宽度随尺寸走，小图标上也不会糊成一团
  $inset  = [int]($size * 0.10)
  $stroke = [single]([math]::Max(1, $size * 0.019))
  $pen = New-Object System.Drawing.Pen -ArgumentList $red, $stroke
  $g.DrawRectangle($pen, $inset, $inset, $size - 2 * $inset, $size - 2 * $inset)

  $fontPx = [single]($size * 0.60)
  $font = New-Object System.Drawing.Font -ArgumentList 'SimSun', $fontPx, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = 'Center'
  $fmt.LineAlignment = 'Center'
  $brush = New-Object System.Drawing.SolidBrush -ArgumentList $paper
  $rect = New-Object System.Drawing.RectangleF -ArgumentList 0, ([single]($size * 0.02)), $size, $size
  $g.DrawString($charGuan, $font, $brush, $rect, $fmt)

  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $ms.ToArray()
  $bmp.Dispose(); $ms.Dispose()
  # 逗号防止 PowerShell 把 byte[] 拆成多个对象，否则调用方拿到的是 4816 个独立字节
  return ,$bytes
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$entries = @()
foreach ($s in $sizes) { $entries += [pscustomobject]@{ Size = $s; Png = (New-IconPng $s) } }

# 手写 ICO：头 + 每个尺寸一条目录，数据区依次拼接（Vista+ 接受 PNG 压缩条目）
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)

$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$entries.Count)

$offset = 6 + 16 * $entries.Count
foreach ($e in $entries) {
  $dim = if ($e.Size -ge 256) { 0 } else { $e.Size }
  $bw.Write([Byte]$dim)
  $bw.Write([Byte]$dim)
  $bw.Write([Byte]0)
  $bw.Write([Byte]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]32)
  $bw.Write([UInt32]$e.Png.Length)
  $bw.Write([UInt32]$offset)
  $offset += $e.Png.Length
}
foreach ($e in $entries) { $bw.Write($e.Png) }

$bw.Flush(); $bw.Dispose(); $fs.Dispose()

"ico: $icoPath  ($([math]::Round((Get-Item $icoPath).Length/1KB,1)) KB, $($entries.Count) sizes)"

# 顺手导出一张 256 预览，方便核对
[System.IO.File]::WriteAllBytes((Join-Path $assets 'icon-preview.png'), $entries[-1].Png)

# ---------- 桌面快捷方式 ----------
$desktop  = [Environment]::GetFolderPath('Desktop')
$lnk      = Join-Path $desktop ("$charGuan$charLan.lnk")
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'

$sh = New-Object -ComObject WScript.Shell
$sc = $sh.CreateShortcut($lnk)
$sc.TargetPath       = $electron
$sc.Arguments        = '"' + $root + '"'
$sc.WorkingDirectory = $root
$sc.IconLocation     = "$icoPath,0"
$sc.Description      = "$charGuan$charLan $charDot 个人账簿"
$sc.WindowStyle      = 1
$sc.Save()

"lnk: $lnk"
