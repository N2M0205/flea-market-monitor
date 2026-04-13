param([string]$Path)
$bytes = 0
try {
    $di = New-Object System.IO.DirectoryInfo($Path)
    foreach ($fi in $di.EnumerateFiles("*", [System.IO.SearchOption]::AllDirectories)) {
        try { $bytes += $fi.Length } catch {}
    }
} catch {}
Write-Host ("{0:N2} GB ({1:N0} MB)" -f ($bytes/1GB), ($bytes/1MB))
