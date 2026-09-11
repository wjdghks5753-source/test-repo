# 최신 코드를 내려받아 src 폴더와 실행 스크립트를 교체한다.
# 직접 실행하기보다 같은 폴더의 "업데이트.cmd" 를 더블클릭하는 쪽이 편하다.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$branchZip = 'https://github.com/wjdghks5753-source/test-repo/archive/refs/heads/claude/notion-todo-list-app-ghibo3.zip'

Write-Host ''
Write-Host '  오늘 할 일 - 업데이트' -ForegroundColor Cyan
Write-Host "  폴더: $PSScriptRoot"
Write-Host ''

if (Get-Process electron -ErrorAction SilentlyContinue) {
    Write-Host '  [!] 앱이 실행 중입니다.' -ForegroundColor Red
    Write-Host '      트레이(시계 옆) 아이콘 우클릭 - 종료 후 다시 실행해 주세요.'
    Write-Host '      실행 중에는 파일이 잠겨 교체할 수 없습니다.'
    exit 1
}

if (-not (Test-Path '.\package.json')) {
    Write-Host '  [!] 이 스크립트가 desktop-todo 폴더 안에 있지 않습니다.' -ForegroundColor Red
    exit 1
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$zip = Join-Path $env:TEMP 'todo-update.zip'
$out = Join-Path $env:TEMP 'todo-update'

Write-Host '  내려받는 중...'
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest $branchZip -OutFile $zip

Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive $zip -DestinationPath $out -Force

$new = (Get-ChildItem $out -Recurse -Directory -Filter 'desktop-todo' | Select-Object -First 1).FullName
if (-not $new) {
    Write-Host '  [!] 내려받은 압축 안에서 desktop-todo 를 찾지 못했습니다.' -ForegroundColor Red
    exit 1
}

# package.json 이 바뀌었으면 의존성도 다시 맞춰야 한다
$needInstall = $false
$oldHash = (Get-FileHash '.\package.json').Hash
$newHash = (Get-FileHash (Join-Path $new 'package.json')).Hash
if ($oldHash -ne $newHash) { $needInstall = $true }

Write-Host '  교체 중...'
Remove-Item '.\src' -Recurse -Force
Copy-Item (Join-Path $new 'src') '.\src' -Recurse -Force
Copy-Item (Join-Path $new 'package.json') '.\' -Force
Copy-Item (Join-Path $new 'README.md') '.\' -Force
Get-ChildItem $new -Filter '*.cmd' | Copy-Item -Destination '.\' -Force
Get-ChildItem $new -Filter '*.ps1' | Copy-Item -Destination '.\' -Force

if ($needInstall) {
    Write-Host '  package.json 이 바뀌어 의존성을 다시 설치합니다...'
    & npm install --no-audit --no-fund
}

Write-Host ''
Write-Host '  교체 완료' -ForegroundColor Green
Write-Host "  버전: $((Get-Content '.\src\main\notion.js' | Measure-Object -Line).Lines) 줄 / notion.js"
Write-Host '  이제 오늘할일.cmd 로 실행하세요.'
