# Fast disk check using robocopy /L (list-only mode) for speed
Write-Host "=== FSUTIL DISK FREE ==="
fsutil volume diskfree C:

Write-Host "`n=== C:\ ROOT FILES ==="
Get-ChildItem C:\ -Force -File | Select-Object Name, @{N='SizeMB';E={[math]::Round($_.Length/1MB,0)}} | Sort-Object SizeMB -Descending | Format-Table -AutoSize

Write-Host "`n=== SPECIAL FOLDERS CHECK ==="
foreach ($name in @('Windows.old','$WinREAgent','Recovery','$Recycle.Bin','System Volume Information','hiberfil.sys','swapfile.sys')) {
    $path = "C:\$name"
    if (Test-Path $path -ErrorAction SilentlyContinue) {
        Write-Host "EXISTS: $path"
    } else {
        Write-Host "NOT FOUND: $path"
    }
}

Write-Host "`n=== C:\ TOP-LEVEL FOLDERS (using compact method) ==="
$dirs = Get-ChildItem -Path C:\ -Force -Directory
foreach ($d in $dirs) {
    try {
        # Use .NET for speed
        $bytes = 0
        $di = New-Object System.IO.DirectoryInfo($d.FullName)
        foreach ($fi in $di.EnumerateFiles("*", [System.IO.SearchOption]::AllDirectories)) {
            try { $bytes += $fi.Length } catch {}
        }
        $gb = [math]::Round($bytes / 1GB, 2)
        $mb = [math]::Round($bytes / 1MB, 0)
        Write-Host ("{0,-50} {1,10} GB  ({2} MB)" -f $d.FullName, $gb, $mb)
    } catch {
        Write-Host ("{0,-50} ACCESS DENIED or ERROR" -f $d.FullName)
    }
}
