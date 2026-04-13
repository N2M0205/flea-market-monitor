# List top-level items in Temp sorted by size (top 30)
$tempPath = "C:\Users\Administrator\AppData\Local\Temp"
Write-Host "=== Top 30 largest items in Temp ==="
$items = Get-ChildItem -Path $tempPath -Force -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.PSIsContainer) {
        $bytes = 0
        try {
            $di = New-Object System.IO.DirectoryInfo($_.FullName)
            foreach ($fi in $di.EnumerateFiles("*", [System.IO.SearchOption]::AllDirectories)) {
                try { $bytes += $fi.Length } catch {}
            }
        } catch {}
        [PSCustomObject]@{
            Name = $_.Name
            Type = "DIR"
            SizeGB = [math]::Round($bytes / 1GB, 2)
            SizeMB = [math]::Round($bytes / 1MB, 0)
        }
    } else {
        [PSCustomObject]@{
            Name = $_.Name
            Type = "FILE"
            SizeGB = [math]::Round($_.Length / 1GB, 2)
            SizeMB = [math]::Round($_.Length / 1MB, 0)
        }
    }
}
$items | Sort-Object SizeGB -Descending | Select-Object -First 30 | Format-Table -AutoSize

# Count puppeteer-like profiles
$puppeteerDirs = Get-ChildItem -Path $tempPath -Force -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'puppeteer|chrome|chromium|.org.chromium' }
Write-Host "`n=== Puppeteer/Chrome profile dirs count ==="
Write-Host "Count: $($puppeteerDirs.Count)"

# Count all directories
$allDirs = Get-ChildItem -Path $tempPath -Force -Directory -ErrorAction SilentlyContinue
Write-Host "Total directories in Temp: $($allDirs.Count)"

# Count claude-related
$claudeDirs = Get-ChildItem -Path $tempPath -Force -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'claude' }
Write-Host "Claude dirs: $($claudeDirs.Count)"
