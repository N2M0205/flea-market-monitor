param([string]$Path, [int]$Depth = 1)
Write-Host "=== Large subdirectories in $Path ==="
Get-ChildItem -Path $Path -Force -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $bytes = 0
    $di = New-Object System.IO.DirectoryInfo($_.FullName)
    foreach ($fi in $di.EnumerateFiles("*", [System.IO.SearchOption]::AllDirectories)) {
        try { $bytes += $fi.Length } catch {}
    }
    [PSCustomObject]@{
        Folder = $_.Name
        SizeGB = [math]::Round($bytes / 1GB, 2)
        SizeMB = [math]::Round($bytes / 1MB, 0)
    }
} | Sort-Object SizeGB -Descending | Format-Table -AutoSize
