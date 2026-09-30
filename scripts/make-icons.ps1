Add-Type -AssemblyName System.Drawing

function New-AppIcon {
    param(
        [string]$Path,
        [int]$Size,
        [bool]$Maskable
    )

    $bmp = [System.Drawing.Bitmap]::new($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::FromArgb(79, 70, 229))

    [single]$pad = 0
    if ($Maskable) { $pad = $Size * 0.16 }

    [single]$x0 = $Size * 0.19 + $pad
    [single]$w = $Size * 0.62 - $pad * 2
    [single]$y0 = $Size * 0.25 + $pad
    [single]$h = $Size * 0.53 - $pad * 2

    $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
    $head = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(224, 231, 255))
    $indigo = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(79, 70, 229))
    $light = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(165, 180, 252))
    $pale = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(199, 210, 254))
    $green = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(16, 185, 129))

    $g.FillRectangle($white, [System.Drawing.RectangleF]::new($x0, $y0, $w, $h))
    $g.FillRectangle($head, [System.Drawing.RectangleF]::new($x0, $y0, $w, $h * 0.22))

    [single]$bw = $w * 0.42
    [single]$bh = $Size * 0.048
    [single]$bx = $x0 + $w * 0.07
    [single]$by = $y0 + $h * 0.36
    [single]$gap = $w * 0.09
    [single]$right = $bx + $bw + $gap
    [single]$row2 = $by + $bh * 1.7
    [single]$row3 = $by + $bh * 3.4

    $g.FillRectangle($indigo, [System.Drawing.RectangleF]::new($bx, $by, $bw, $bh))
    $g.FillRectangle($light, [System.Drawing.RectangleF]::new($right, $by, $bw, $bh))
    $g.FillRectangle($light, [System.Drawing.RectangleF]::new($bx, $row2, $bw, $bh))
    $g.FillRectangle($indigo, [System.Drawing.RectangleF]::new($right, $row2, $bw, $bh))
    $g.FillRectangle($pale, [System.Drawing.RectangleF]::new($bx, $row3, ($bw * 2 + $gap), $bh))

    [single]$rr = $Size * 0.135
    [single]$cx = $x0 + $w - $rr * 0.75
    [single]$cy = $y0 + $h - $rr * 0.75
    [single]$ring = $Size * 0.014

    $g.FillEllipse($white, [System.Drawing.RectangleF]::new(($cx - $rr - $ring), ($cy - $rr - $ring), (($rr * 2) + ($ring * 2)), (($rr * 2) + ($ring * 2))))
    $g.FillEllipse($green, [System.Drawing.RectangleF]::new(($cx - $rr), ($cy - $rr), ($rr * 2), ($rr * 2)))

    $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, ($Size * 0.032))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    $pts = [System.Drawing.PointF[]]::new(3)
    $pts[0] = [System.Drawing.PointF]::new(($cx - $rr * 0.45), $cy)
    $pts[1] = [System.Drawing.PointF]::new(($cx - $rr * 0.05), ($cy + $rr * 0.4))
    $pts[2] = [System.Drawing.PointF]::new(($cx + $rr * 0.55), ($cy - $rr * 0.42))
    $g.DrawLines($pen, $pts)

    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

    $pen.Dispose()
    $g.Dispose()
    $bmp.Dispose()
}

$out = Join-Path (Split-Path -Parent $PSScriptRoot) 'public'
New-AppIcon -Path (Join-Path $out 'icon-192.png') -Size 192 -Maskable $false
New-AppIcon -Path (Join-Path $out 'icon-512.png') -Size 512 -Maskable $false
New-AppIcon -Path (Join-Path $out 'icon-maskable.png') -Size 512 -Maskable $true
Get-ChildItem $out | Select-Object Name, Length
