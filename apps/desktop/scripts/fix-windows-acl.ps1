# AIASys Windows 桌面版安装目录 ACL 修复脚本
#
# 用途：修复 Windows 11 24H2/25H2 上 Electron/Chromium GPU sandbox 因安装目录
# ACL 缺少 LPAC 权限或包含僵尸 SID 而导致渲染进程崩溃的问题。
#
# 触发场景：
#   - 双击 AIASys.exe 后弹窗"渲染进程异常退出，应用将尝试重新加载页面"
#   - 命令行启动时看到 GPU process exited unexpectedly: exit_code=-2147483645
#   - 之前版本正常，升级 Windows 或重新安装后出现崩溃
#
# 相关 issue: https://github.com/electron/electron/issues/51761
#
# 使用方法：
#   1. 关闭 AIASys
#   2. 以管理员身份打开 PowerShell
#   3. 运行本脚本（如果安装路径非默认，可通过 -InstallDir 参数指定）

param(
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\AIASys"
)

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Path $InstallDir)) {
    Write-Host "未找到安装目录: $InstallDir" -ForegroundColor Red
    Write-Host "请通过 -InstallDir 参数指定正确的安装路径。" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Admin)) {
    Write-Host "需要管理员权限才能修复安装目录权限。" -ForegroundColor Red
    Write-Host "请右键 PowerShell 选择"以管理员身份运行"后重试。" -ForegroundColor Yellow
    exit 1
}

Write-Host "准备修复安装目录权限: $InstallDir" -ForegroundColor Cyan

# 1) 启用继承，减少孤立/不可解析 SID 的影响
Write-Host "步骤 1/2: 启用权限继承..." -ForegroundColor Cyan
& icacls $InstallDir /inheritance:e /t /c /q
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ 权限继承已启用" -ForegroundColor Green
} else {
    Write-Host "  ✗ 启用权限继承失败（代码: $LASTEXITCODE），继续下一步..." -ForegroundColor Yellow
}

# 2) 授予 ALL RESTRICTED APPLICATION PACKAGES (S-1-15-2-2) 读取权限
Write-Host "步骤 2/2: 授予 LPAC 权限..." -ForegroundColor Cyan
& icacls $InstallDir /grant '*S-1-15-2-2:(OI)(CI)(RX)' /t /c /q
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ LPAC 权限已修复" -ForegroundColor Green
} else {
    Write-Host "  ✗ 修复 LPAC 权限失败（代码: $LASTEXITCODE）" -ForegroundColor Red
    exit 1
}

Write-Host "`n权限修复完成，请重新启动 AIASys。" -ForegroundColor Green
