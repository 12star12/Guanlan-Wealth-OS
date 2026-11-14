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

# 调色：与界面一套（纸、墨、朱），海用旧地图那种手染青
$ink    = [System.Drawing.Color]::FromArgb(43, 38, 32)
$sun    = [System.Drawing.Color]::FromArgb(178, 58, 46)
$skyTop = [System.Drawing.Color]::FromArgb(253, 248, 236)
$skyBot = [System.Drawing.Color]::FromArgb(238, 224, 197)
$seaTop = [System.Drawing.Color]::FromArgb(163, 190, 186)
$seaBot = [System.Drawing.Color]::FromArgb(118, 149, 145)

<#
  绘制说明
  --------
  母版 1024 画一次，再双三次降采样到各尺寸。
  小图标（16px）不靠细节，靠三个大形：红日、墨舟、三道浪。
  所有坐标用 0~1 归一化，乘 $S 得到像素。
#>
function New-IconPng([int]$size) {
  $S = 1024
  $bmp = New-Object System.Drawing.Bitmap -ArgumentList $S, $S
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode       = 'AntiAlias'
  $g.CompositingQuality  = 'HighQuality'
  $g.PixelOffsetMode     = 'HighQuality'
  $g.InterpolationMode   = 'HighQualityBicubic'
  $g.Clear([System.Drawing.Color]::Transparent)

  # ---------- 圆角方形底 ----------
  $r = [single](0.22 * $S)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $r, $r, 180, 90)
  $path.AddArc($S - $r, 0, $r, $r, 270, 90)
  $path.AddArc($S - $r, $S - $r, $r, $r, 0, 90)
  $path.AddArc(0, $S - $r, $r, $r, 90, 90)
  $path.CloseFigure()

  $skyRect = New-Object System.Drawing.RectangleF -ArgumentList 0, 0, $S, $S
  $skyBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList $skyRect, $skyTop, $skyBot, ([single]90)
  $g.FillPath($skyBrush, $path)

  $g.SetClip($path)

  # ---------- 海：地平线以下 ----------
  $horizon = [single](0.640 * $S)
  $seaRect = New-Object System.Drawing.RectangleF -ArgumentList 0, $horizon, $S, ($S - $horizon)
  $seaBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList $seaRect, $seaTop, $seaBot, ([single]90)
  $g.FillRectangle($seaBrush, 0, $horizon, $S, $S - $horizon)

  # 地平线压一道淡墨，把天与海分开
  $hPen = New-Object System.Drawing.Pen -ArgumentList ([System.Drawing.Color]::FromArgb(60, 43, 38, 32)), ([single](0.006 * $S))
  $g.DrawLine($hPen, 0, $horizon, $S, $horizon)

  # ---------- 红日：在帆的右边，不被遮住 ----------
  $cx = [single](0.782 * $S)
  $cy = [single](0.298 * $S)
  $rr = [single](0.082 * $S)
  $sunBrush = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::FromArgb(240, 178, 58, 46))
  $g.FillEllipse($sunBrush, $cx - $rr, $cy - $rr, 2 * $rr, 2 * $rr)

  # ---------- 浪：先画，让船压在上面，船底才不会被墨吃掉 ----------
  $w1 = New-Object System.Drawing.Drawing2D.GraphicsPath
  $w1.AddBezier(
    [single](0.020 * $S), [single](0.716 * $S),
    [single](0.270 * $S), [single](0.684 * $S),
    [single](0.500 * $S), [single](0.762 * $S),
    [single](0.740 * $S), [single](0.718 * $S))
  $w1.AddBezier(
    [single](0.740 * $S), [single](0.718 * $S),
    [single](0.840 * $S), [single](0.694 * $S),
    [single](0.910 * $S), [single](0.704 * $S),
    [single](0.980 * $S), [single](0.712 * $S))
  $wavePen = New-Object System.Drawing.Pen -ArgumentList ([System.Drawing.Color]::FromArgb(225, 43, 38, 32)), ([single](0.040 * $S))
  $wavePen.StartCap = 'Round'
  $wavePen.EndCap   = 'Round'
  $g.DrawPath($wavePen, $w1)

  $w2 = New-Object System.Drawing.Drawing2D.GraphicsPath
  $w2.AddBezier(
    [single](0.055 * $S), [single](0.800 * $S),
    [single](0.310 * $S), [single](0.768 * $S),
    [single](0.545 * $S), [single](0.846 * $S),
    [single](0.790 * $S), [single](0.800 * $S))
  $w2.AddBezier(
    [single](0.790 * $S), [single](0.800 * $S),
    [single](0.868 * $S), [single](0.782 * $S),
    [single](0.920 * $S), [single](0.786 * $S),
    [single](0.965 * $S), [single](0.792 * $S))
  $wavePen2 = New-Object System.Drawing.Pen -ArgumentList ([System.Drawing.Color]::FromArgb(180, 43, 38, 32)), ([single](0.030 * $S))
  $wavePen2.StartCap = 'Round'
  $wavePen2.EndCap   = 'Round'
  $g.DrawPath($wavePen2, $w2)

  $w3 = New-Object System.Drawing.Drawing2D.GraphicsPath
  $w3.AddBezier(
    [single](0.120 * $S), [single](0.884 * $S),
    [single](0.350 * $S), [single](0.858 * $S),
    [single](0.560 * $S), [single](0.918 * $S),
    [single](0.775 * $S), [single](0.878 * $S))
  $wavePen3 = New-Object System.Drawing.Pen -ArgumentList ([System.Drawing.Color]::FromArgb(135, 43, 38, 32)), ([single](0.022 * $S))
  $wavePen3.StartCap = 'Round'
  $wavePen3.EndCap   = 'Round'
  $g.DrawPath($wavePen3, $w3)

  # ---------- 船 ----------
  # 整条船放大一点再画，小图标（16/32）才认得出；枢轴放在水面，船不会漂起来
  $state = $g.Save()
  $px = [single](0.470 * $S)
  $py = [single](0.620 * $S)
  $g.TranslateTransform($px, $py)
  $g.ScaleTransform([single]1.10, [single]1.10)
  $g.TranslateTransform(-$px, -$py)

  $inkBrush = New-Object System.Drawing.SolidBrush -ArgumentList $ink

  # 桅杆
  $g.FillRectangle($inkBrush, [single](0.452 * $S), [single](0.278 * $S), [single](0.017 * $S), [single](0.322 * $S))

  # 主帆：右边一片，微微鼓起
  $sail = New-Object System.Drawing.Drawing2D.GraphicsPath
  $sail.AddLine([single](0.469 * $S), [single](0.288 * $S), [single](0.644 * $S), [single](0.328 * $S))
  $sail.AddBezier(
    [single](0.644 * $S), [single](0.328 * $S),
    [single](0.668 * $S), [single](0.398 * $S),
    [single](0.656 * $S), [single](0.480 * $S),
    [single](0.632 * $S), [single](0.556 * $S))
  $sail.AddLine([single](0.632 * $S), [single](0.556 * $S), [single](0.469 * $S), [single](0.556 * $S))
  $sail.CloseFigure()
  $g.FillPath($inkBrush, $sail)

  # 帆上的两道横桁：纸色细线，只是肌理，缩到 16px 会自然消失
  $battenPen = New-Object System.Drawing.Pen -ArgumentList ([System.Drawing.Color]::FromArgb(74, 240, 228, 204)), ([single](0.0075 * $S))
  $g.DrawLine($battenPen, [single](0.488 * $S), [single](0.394 * $S), [single](0.652 * $S), [single](0.388 * $S))
  $g.DrawLine($battenPen, [single](0.470 * $S), [single](0.478 * $S), [single](0.647 * $S), [single](0.472 * $S))

  # 前帆：左边窄三角
  $jib = New-Object System.Drawing.Drawing2D.GraphicsPath
  $jib.AddLine([single](0.436 * $S), [single](0.330 * $S), [single](0.286 * $S), [single](0.552 * $S))
  $jib.AddBezier(
    [single](0.286 * $S), [single](0.552 * $S),
    [single](0.350 * $S), [single](0.562 * $S),
    [single](0.396 * $S), [single](0.560 * $S),
    [single](0.436 * $S), [single](0.558 * $S))
  $jib.CloseFigure()
  $g.FillPath($inkBrush, $jib)

  # 船身：上宽下窄、船底微弧，才不会像只碗
  $hull = New-Object System.Drawing.Drawing2D.GraphicsPath
  $hull.AddLine([single](0.250 * $S), [single](0.596 * $S), [single](0.690 * $S), [single](0.596 * $S))
  $hull.AddBezier(
    [single](0.690 * $S), [single](0.596 * $S),
    [single](0.686 * $S), [single](0.652 * $S),
    [single](0.668 * $S), [single](0.686 * $S),
    [single](0.636 * $S), [single](0.700 * $S))
  $hull.AddBezier(
    [single](0.636 * $S), [single](0.700 * $S),
    [single](0.540 * $S), [single](0.716 * $S),
    [single](0.396 * $S), [single](0.716 * $S),
    [single](0.302 * $S), [single](0.700 * $S))
  $hull.AddBezier(
    [single](0.302 * $S), [single](0.700 * $S),
    [single](0.270 * $S), [single](0.686 * $S),
    [single](0.254 * $S), [single](0.652 * $S),
    [single](0.250 * $S), [single](0.596 * $S))
  $hull.CloseFigure()
  $g.FillPath($inkBrush, $hull)

  $g.Restore($state)

  $g.ResetClip()

  # ---------- 降采样 ----------
  $out = New-Object System.Drawing.Bitmap -ArgumentList $size, $size
  $gd = [System.Drawing.Graphics]::FromImage($out)
  $gd.InterpolationMode   = 'HighQualityBicubic'
  $gd.PixelOffsetMode     = 'HighQuality'
  $gd.CompositingQuality  = 'HighQuality'
  $gd.DrawImage($bmp, 0, 0, $size, $size)
  $gd.Dispose()

  $ms = New-Object System.IO.MemoryStream
  $out.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $ms.ToArray()

  $out.Dispose(); $ms.Dispose(); $bmp.Dispose(); $g.Dispose()
  # 逗号防止 PowerShell 把 byte[] 拆成多个对象，否则调用方拿到的是几千个独立字节
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

# 导出预览：大图看细节，32/16 看缩小后还认不认得出
foreach ($e in $entries) {
  if ($e.Size -in @(16, 32, 48, 128, 256)) {
    [System.IO.File]::WriteAllBytes((Join-Path $assets "icon-$($e.Size).png"), $e.Png)
  }
}

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
