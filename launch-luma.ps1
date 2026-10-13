$ErrorActionPreference = "Stop"

$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$distDirectory = Join-Path $projectDirectory "dist"
$selectedUrl = $null

foreach ($port in 4173..4183) {
    $candidateUrl = "http://127.0.0.1:$port"

    try {
        $response = Invoke-WebRequest -Uri $candidateUrl -UseBasicParsing -TimeoutSec 1
        if ($response.Content -match "<title>Luma") {
            $selectedUrl = $candidateUrl
            break
        }

        continue
    }
    catch {
        # No server is listening on this port, so Luma can use it.
    }

    $pythonCommand = Get-Command "python" -ErrorAction SilentlyContinue
    if (-not $pythonCommand) {
        $pythonCommand = Get-Command "py" -ErrorAction SilentlyContinue
    }

    if (-not $pythonCommand) {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show(
            "Luma cần Python để chạy máy chủ ảnh cục bộ.",
            "Luma",
            "OK",
            "Error"
        ) | Out-Null
        exit 1
    }

    $arguments = @(
        "-m",
        "http.server",
        "$port",
        "--bind",
        "127.0.0.1",
        "--directory",
        ('"{0}"' -f $distDirectory)
    )

    Start-Process `
        -FilePath $pythonCommand.Source `
        -ArgumentList $arguments `
        -WorkingDirectory $distDirectory `
        -WindowStyle Hidden

    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 150
        try {
            $response = Invoke-WebRequest -Uri $candidateUrl -UseBasicParsing -TimeoutSec 1
            if ($response.Content -match "<title>Luma") {
                $selectedUrl = $candidateUrl
                break
            }
        }
        catch {
            # The local server is still starting.
        }
    }

    if ($selectedUrl) {
        break
    }
}

if (-not $selectedUrl) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
        "Không thể khởi động Luma. Hãy kiểm tra lại Python hoặc cổng mạng cục bộ.",
        "Luma",
        "OK",
        "Error"
    ) | Out-Null
    exit 1
}

Start-Process $selectedUrl
