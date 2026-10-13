$ErrorActionPreference = "Stop"

# Trình khởi chạy LUMA cho Windows (được gọi từ Luma.bat).
# Ưu tiên Node.js (server.mjs, tự build src/ → dist/). Nếu không có Node thì dùng Python
# với MIME đúng cho file .js (ES module cần "text/javascript").

$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$distDirectory = Join-Path $projectDirectory "dist"

function Show-LumaError([string] $message) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($message, "LUMA", "OK", "Error") | Out-Null
}

function Test-LumaServer([string] $url) {
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1
        return ($response.Content -match "<title>LUMA")
    }
    catch {
        return $false
    }
}

$nodeCommand = Get-Command "node" -ErrorAction SilentlyContinue
$pythonCommand = Get-Command "python" -ErrorAction SilentlyContinue
if (-not $pythonCommand) { $pythonCommand = Get-Command "py" -ErrorAction SilentlyContinue }

if ($nodeCommand) {
    # Luôn build lại để dist/ khớp với src/
    & $nodeCommand.Source (Join-Path $projectDirectory "scripts\build.mjs") | Out-Null
}
elseif (-not (Test-Path (Join-Path $distDirectory "index.html"))) {
    Show-LumaError "LUMA cần Node.js (khuyên dùng) để chạy. Hãy cài Node.js từ nodejs.org rồi mở lại."
    exit 1
}

if (-not $nodeCommand -and -not $pythonCommand) {
    Show-LumaError "LUMA cần Node.js (khuyên dùng) hoặc Python để chạy máy chủ ảnh cục bộ."
    exit 1
}

$selectedUrl = $null

foreach ($port in 4173..4183) {
    $candidateUrl = "http://127.0.0.1:$port"

    if (Test-LumaServer $candidateUrl) {
        $selectedUrl = $candidateUrl
        break
    }

    # Cổng đang bị chương trình khác dùng → thử cổng tiếp theo
    $inUse = $false
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect("127.0.0.1", $port)
        $inUse = $client.Connected
        $client.Close()
    }
    catch { }
    if ($inUse) { continue }

    if ($nodeCommand) {
        $env:PORT = "$port"
        Start-Process `
            -FilePath $nodeCommand.Source `
            -ArgumentList ('"{0}"' -f (Join-Path $projectDirectory "server.mjs")) `
            -WorkingDirectory $projectDirectory `
            -WindowStyle Hidden
    }
    else {
        $pythonScript = "import http.server,functools,sys;h=http.server.SimpleHTTPRequestHandler;h.extensions_map.update({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json'});http.server.ThreadingHTTPServer(('127.0.0.1',int(sys.argv[1])),functools.partial(h,directory=sys.argv[2])).serve_forever()"
        Start-Process `
            -FilePath $pythonCommand.Source `
            -ArgumentList @("-c", ('"{0}"' -f $pythonScript), "$port", ('"{0}"' -f $distDirectory)) `
            -WorkingDirectory $distDirectory `
            -WindowStyle Hidden
    }

    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 150
        if (Test-LumaServer $candidateUrl) {
            $selectedUrl = $candidateUrl
            break
        }
    }

    if ($selectedUrl) { break }
}

if (-not $selectedUrl) {
    Show-LumaError "Không thể khởi động LUMA. Hãy kiểm tra Node.js/Python hoặc cổng mạng cục bộ 4173–4183."
    exit 1
}

Start-Process $selectedUrl
