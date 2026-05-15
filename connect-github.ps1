# GitHub 원격 저장소 연결
# 사용: 프로젝트 폴더에서 PowerShell로 실행
#   .\connect-github.ps1
$ErrorActionPreference = "Stop"
$RemoteUrl = "https://github.com/mungdi93-crypto/himart.git"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Error "Git이 PATH에 없습니다. Git for Windows를 설치한 뒤 다시 실행하세요."
}

if (-not (Test-Path .git)) {
  git init
  Write-Host "[ok] git init"
}

$hasOrigin = git remote get-url origin 2>$null
if ($LASTEXITCODE -eq 0) {
  git remote set-url origin $RemoteUrl
  Write-Host "[ok] git remote set-url origin $RemoteUrl"
} else {
  git remote add origin $RemoteUrl
  Write-Host "[ok] git remote add origin $RemoteUrl"
}

git branch -M main 2>$null

Write-Host ""
Write-Host "원격 확인:" -ForegroundColor Cyan
git remote -v

Write-Host ""
Write-Host "다음 단계 (처음 푸시):" -ForegroundColor Yellow
Write-Host "  git add ."
Write-Host "  git commit -m `"Initial commit`""
Write-Host "  git push -u origin main"
Write-Host ""
Write-Host "원격에 이미 커밋이 있으면 먼저: git pull origin main --allow-unrelated-histories"
