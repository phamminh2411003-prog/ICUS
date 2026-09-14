$port = 8080
$prefix = "http://127.0.0.1:$port/"
$baseDir = $PSScriptRoot

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "HTTP Server listening on $prefix (BaseDir: $baseDir)"

$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".png"  = "image/png"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
    ".json" = "application/json"
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $state = [PSCustomObject]@{
            Context = $context
            BaseDir = $baseDir
            Mimes   = $mimeTypes
        }
        [System.Threading.ThreadPool]::QueueUserWorkItem({
            param($s)
            $ctx = $s.Context
            $dir = $s.BaseDir
            $mimes = $s.Mimes
            $request = $ctx.Request
            $response = $ctx.Response
            try {
                $rawUrl = $request.RawUrl.Split('?')[0].TrimStart('/')
                if ([string]::IsNullOrEmpty($rawUrl)) {
                    $rawUrl = "index.html"
                }

                $rawPath = [System.Uri]::UnescapeDataString($rawUrl).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
                $filePath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($dir, $rawPath))
                if (-not $filePath.StartsWith($dir, [System.StringComparison]::OrdinalIgnoreCase)) {
                    $response.StatusCode = 403
                    $response.Close()
                    return
                }

                if (Test-Path $filePath -PathType Leaf) {
                    $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                    $mime = $mimes[$ext]
                    if (-not $mime) { $mime = "application/octet-stream" }
                    $response.ContentType = $mime
                    
                    $bytes = [System.IO.File]::ReadAllBytes($filePath)
                    $response.ContentLength64 = $bytes.Length
                    $response.StatusCode = 200

                    if ($request.HttpMethod -ne "HEAD") {
                        $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    }
                } else {
                    $response.StatusCode = 404
                    $buffer = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
                    $response.ContentLength64 = $buffer.Length
                    if ($request.HttpMethod -ne "HEAD") {
                        $response.OutputStream.Write($buffer, 0, $buffer.Length)
                    }
                }
            } catch {
                # Log and ignore client disconnects
            } finally {
                try { $response.Close() } catch {}
            }
        }, $context) | Out-Null
    }
} finally {
    $listener.Stop()
}
