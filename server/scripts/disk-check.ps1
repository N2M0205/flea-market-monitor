# Measure all top-level folders on C:\
Write-Host "=== C:\ FOLDER SIZES ==="
$results = @()
Get-ChildItem -Path C:\ -Force -Directory | ForEach-Object {
    $size = (Get-ChildItem $_.FullName -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    $results += [PSCustomObject]@{
        Folder = $_.FullName
        SizeGB = [math]::Round($size / 1GB, 2)
        SizeMB = [math]::Round($size / 1MB, 0)
    }
}
$results | Sort-Object SizeGB -Descending | Format-Table -AutoSize

# Root-level files
Write-Host "`n=== C:\ ROOT FILES ==="
Get-ChildItem C:\ -Force -File | Select-Object Name, @{N='SizeGB';E={[math]::Round($_.Length/1GB,2)}}, @{N='SizeMB';E={[math]::Round($_.Length/1MB,0)}} | Sort-Object SizeGB -Descending | Format-Table -AutoSize

# Special folders check
Write-Host "`n=== SPECIAL FOLDERS ==="
foreach ($name in @('Windows.old','$WinREAgent','Recovery','$Recycle.Bin','System Volume Information')) {
    $path = "C:\$name"
    if (Test-Path $path) {
        Write-Host "EXISTS: $path"
    } else {
        Write-Host "NOT FOUND: $path"
    }
}

# NTFS disk free
Write-Host "`n=== FSUTIL DISK FREE ==="
fsutil volume diskfree C:

# Total summary
Write-Host "`n=== TOTAL ==="
$total = ($results | Measure-Object -Property SizeGB -Sum).Sum
Write-Host "Folders total: $total GB"
