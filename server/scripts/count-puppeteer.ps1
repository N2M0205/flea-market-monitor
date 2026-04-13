$folders = @("C:\Users\Administrator\AppData\Local\Temp\1", "C:\Users\Administrator\AppData\Local\Temp\2", "C:\Users\Administrator\AppData\Local\Temp\3")
foreach ($f in $folders) {
    $total = (Get-ChildItem $f -Force -Directory -ErrorAction SilentlyContinue).Count
    $puppeteer = (Get-ChildItem $f -Force -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'puppeteer' }).Count
    Write-Host "$f : Total dirs=$total, Puppeteer dirs=$puppeteer"
}

# Check if any Chrome processes are running
Write-Host "`nChrome processes:"
Get-Process -Name chrome -ErrorAction SilentlyContinue | Select-Object Id, StartTime | Format-Table -AutoSize
if (-not (Get-Process -Name chrome -ErrorAction SilentlyContinue)) {
    Write-Host "No Chrome processes running"
}
