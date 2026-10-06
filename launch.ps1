# 1. Dọn dẹp process cũ
Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force
$conns = Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue
foreach ($c in $conns) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
if (Test-Path "tunnel.log") { Remove-Item "tunnel.log" -Force }

# 2. Khởi chạy server tĩnh cục bộ
$serveScript = Join-Path $PSScriptRoot "serve.ps1"
$serverProcess = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$serveScript`"" -WorkingDirectory $PSScriptRoot -PassThru -WindowStyle Hidden
Write-Host "Local server started with PID: $($serverProcess.Id)"
Start-Sleep -Seconds 2

$localUrl = "http://127.0.0.1:8080/"
$adminUrl = "http://127.0.0.1:8080/admin"
Write-Host "LOCAL_WEBSITE_URL: $localUrl"
Write-Host "CRM_ADMIN_URL:     $adminUrl"

# 3. Kiểm tra và khởi chạy Cloudflare Tunnel (nếu có file cloudflared.exe)
$cfPath = $null
if (Test-Path ".\cloudflared.exe") {
    $cfPath = ".\cloudflared.exe"
} elseif (Get-Command "cloudflared" -ErrorAction SilentlyContinue) {
    $cfPath = "cloudflared"
}

if ($cfPath) {
    $cfProcess = Start-Process -FilePath $cfPath -ArgumentList "tunnel --url http://127.0.0.1:8080 --logfile tunnel.log" -WorkingDirectory $PSScriptRoot -PassThru -WindowStyle Hidden
    Write-Host "Cloudflare tunnel started with PID: $($cfProcess.Id)"

    $tunnelUrl = $null
    for ($i = 0; $i -lt 20; $i++) {
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
        Write-Host "[WARNING] Khong lay duoc Tunnel URL, dang su dung Local URL."
    }
} else {
    Write-Host "[INFO] Khong tim thay cloudflared.exe. Website dang san sang tai Local."
}

# 4. Tu dong mo trinh duyet
Start-Process $localUrl
Write-Host "Website dang chay tai: $localUrl"
