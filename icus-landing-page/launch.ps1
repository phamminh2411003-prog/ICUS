# 1. Dọn dẹp process cũ
Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force
$conns = Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue
foreach ($c in $conns) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
if (Test-Path "tunnel.log") { Remove-Item "tunnel.log" -Force }

# 2. Khởi chạy server tĩnh
$serverProcess = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File .\serve.ps1" -PassThru -WindowStyle Hidden
Write-Host "Server started with PID: $($serverProcess.Id)"

Start-Sleep -Seconds 2

# 3. Khởi chạy Cloudflare Quick Tunnel
$cfProcess = Start-Process -FilePath ".\cloudflared.exe" -ArgumentList "tunnel --url http://127.0.0.1:8080 --logfile tunnel.log" -PassThru -WindowStyle Hidden
Write-Host "Cloudflare tunnel started with PID: $($cfProcess.Id)"

# 4. Đọc URL từ file log
$tunnelUrl = $null
for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path "tunnel.log") {
        $log = Get-Content "tunnel.log" -Raw
        if ($log -match 'https://[a-zA-Z0-9-]+\.trycloudflare\.com') {
            $tunnelUrl = $Matches[0]
            break
        }
    }
}

if ($tunnelUrl) {
    Write-Host "SUCCESS_TUNNEL_URL: $tunnelUrl"
} else {
    Write-Host "FAILED_TO_GET_URL"
    if (Test-Path "tunnel.log") {
        Get-Content "tunnel.log" -Tail 20
    }
}
