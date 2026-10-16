$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding utf8 | ConvertFrom-Json).version
$portablePath = Join-Path $projectRoot "07_发布成品\FileCanvas-$version-Windows-x64.exe"
$portablePath = [System.IO.Path]::GetFullPath($portablePath)
$results = @()
$profile = Join-Path ([IO.Path]::GetTempPath()) ('filecanvas-e2e-portable-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $profile | Out-Null
$originalProfileFlag = $env:FILECANVAS_TEST_PROFILE
$originalDataDirectory = $env:FILECANVAS_TEST_DATA
$env:FILECANVAS_TEST_PROFILE = '1'
$env:FILECANVAS_TEST_DATA = $profile
try {
foreach ($waitForPage in @($false, $true)) {
    $launchTime = Get-Date
    $launcher = Start-Process -FilePath $portablePath -PassThru -WindowStyle Hidden
    $windowProcess = $null
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        Start-Sleep -Milliseconds 500
        $windowProcess = Get-Process -Name FileCanvas -ErrorAction SilentlyContinue | Where-Object {
            $_.StartTime -ge $launchTime.AddSeconds(-1) -and $_.MainWindowTitle -like 'FileCanvas*'
        } | Select-Object -First 1
        if ($windowProcess) { break }
    }
    if (-not $windowProcess) { throw '便携包未在等待时间内显示主窗口。' }
    if ($waitForPage) { Start-Sleep -Seconds 3 }
    if (-not $windowProcess.CloseMainWindow()) { throw '无法发送窗口关闭请求。' }
    if (-not $windowProcess.WaitForExit(10000)) { throw '便携应用没有正常结束。' }
    $launcher.WaitForExit(10000) | Out-Null
    $results += @{ status = 'passed'; close = $(if ($waitForPage) { '正常加载后关闭' } else { '窗口刚出现即关闭' }) }
}
} finally {
    $env:FILECANVAS_TEST_PROFILE = $originalProfileFlag
    $env:FILECANVAS_TEST_DATA = $originalDataDirectory
}
$report = [ordered]@{
    status = 'passed'
    artifact = $portablePath
    tests = $results
    sizeBytes = (Get-Item -LiteralPath $portablePath).Length
    sha256 = (Get-FileHash -LiteralPath $portablePath -Algorithm SHA256).Hash
    signature = (Get-AuthenticodeSignature -LiteralPath $portablePath).Status.ToString()
}
$outputPath = Join-Path $PSScriptRoot '..\..\03_测试结果\portable-smoke.json'
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $outputPath -Encoding utf8
$report | ConvertTo-Json -Depth 5
