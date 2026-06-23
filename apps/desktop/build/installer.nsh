; AIASys NSIS 自定义脚本
; 由 electron-builder 自动包含

; 安装程序需要管理员权限，以便自动开启 Windows 长路径支持。
; 注意：这里只控制安装包本身，不会修改 apps/desktop/package.json 里的 asInvoker，
; 因此安装后的 AIASys.exe 仍然保持标准用户权限，不影响拖拽文件兼容性。
RequestExecutionLevel admin

; ==================== 安装时 ====================

!macro customInstall
  ; 尝试开启 Windows 长路径支持（需要重启生效）并修复安装目录权限
  UserInfo::GetAccountType
  Pop $R1
  StrCmp $R1 "Admin" hasAdmin

  ; 非管理员：无法修改注册表和目录 ACL，给出明确提示后跳过
  MessageBox MB_OK|MB_ICONINFORMATION "需要管理员权限才能自动启用 Windows 长路径支持并修复安装目录权限。$\n若安装后启动时提示渲染进程异常退出，请右键以管理员身份重新运行本安装程序。$\n或安装完成后手动设置注册表：$\nHKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\FileSystem$\nLongPathsEnabled = 1（DWORD）$\n修改后需要重启系统生效。"
  Goto installDone

hasAdmin:
  ; 先读取当前值，避免重复写入/提示
  ReadRegDWORD $R2 HKLM "SYSTEM\CurrentControlSet\Control\FileSystem" "LongPathsEnabled"
  IntCmp $R2 1 longPathAlreadyEnabled

  WriteRegDWORD HKLM "SYSTEM\CurrentControlSet\Control\FileSystem" "LongPathsEnabled" 1
  DetailPrint "已启用 Windows 长路径支持（需要重启生效）"
  Goto longPathDone

longPathAlreadyEnabled:
  DetailPrint "Windows 长路径支持已处于开启状态"

longPathDone:
  ; ===================================================================
  ; 修复 Windows 11 24H2/25H2 上 Electron/Chromium GPU sandbox 因安装目录
  ; ACL 中缺少 LPAC 权限或存在僵尸 SID 而导致渲染进程崩溃的问题。
  ; 相关 issue: https://github.com/electron/electron/issues/51761
  ;
  ; Chromium GPU 进程启动时会校验安装目录是否对
  ; ALL RESTRICTED APPLICATION PACKAGES (S-1-15-2-2) 可读。若目录 ACL
  ; 缺少该权限或包含不可解析的僵尸 SID，GPU 进程会以 exit code
  ; -2147483645 退出，表现为"渲染进程异常退出"。
  ; ===================================================================
  DetailPrint "正在检查安装目录权限..."

  ; 1) 启用继承，确保权限模型与父目录一致，减少孤立/不可解析 SID 的影响。
  nsExec::ExecToStack 'icacls "$INSTDIR" /inheritance:e /t /c /q'
  Pop $R0
  StrCmp $R0 "0" enableInheritanceOk
  DetailPrint "启用安装目录继承权限失败（代码: $R0）"
  Goto enableInheritanceDone
enableInheritanceOk:
  DetailPrint "安装目录继承权限已启用"
enableInheritanceDone:

  ; 2) 授予 ALL RESTRICTED APPLICATION PACKAGES (S-1-15-2-2) 读取权限，
  ;    这是 Chromium GPU sandbox 在 Windows 11 新版本中要求的权限。
  nsExec::ExecToStack 'icacls "$INSTDIR" /grant *S-1-15-2-2:(OI)(CI)(RX) /t /c /q'
  Pop $R0
  StrCmp $R0 "0" grantLpacOk
  DetailPrint "修复安装目录 LPAC 权限失败（代码: $R0）"
  Goto grantLpacDone
grantLpacOk:
  DetailPrint "安装目录 LPAC 权限已修复"
grantLpacDone:

installDone:
!macroend

; ==================== 安装前 ====================

!macro customInit
  ; 安装前检测应用窗口是否正在运行（FindWindow 为 NSIS 内置指令，无需插件）
  ; 窗口标题与 main.cjs 中 BrowserWindow.title 保持一致
  FindWindow $R0 "" "AIASys"
  IntCmp $R0 0 checkProcess

  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "AIASys 正在运行。安装前需要关闭该应用。点击确定自动关闭并继续安装，点击取消退出安装程序。" IDOK closeApp IDCANCEL cancelInstall

checkProcess:
  ; 安装前检测并终止正在运行的 AIASys 进程
  ; 使用 taskkill 替代 nsProcess 插件（CI 环境中 nsProcess 插件可能缺失）
  nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq AIASys.exe" 2>NUL | find /I "AIASys.exe"'
  Pop $R0
  StrCmp $R0 "0" 0 continueInstall

  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "AIASys 正在运行。安装前需要关闭该应用。点击确定自动关闭并继续安装，点击取消退出安装程序。" IDOK closeApp IDCANCEL cancelInstall

closeApp:
  nsExec::ExecToStack 'taskkill /F /IM "AIASys.exe" 2>NUL'
  Sleep 2000
  Goto continueInstall

cancelInstall:
  Quit

continueInstall:
!macroend

; ==================== 卸载前 ====================

!macro customUnInit
  ; 卸载前检测并终止正在运行的 AIASys 进程
  FindWindow $R0 "" "AIASys"
  IntCmp $R0 0 continueUninstall
    nsExec::ExecToStack 'taskkill /F /IM "AIASys.exe" 2>NUL'
    Sleep 1000
  continueUninstall:
!macroend

; ==================== 卸载确认 ====================

!macro customUnInstall
  ; 在卸载文件完成后，询问是否删除用户数据
  ; 注意：用户数据目录名由 Electron app name（package.json 的 name 字段）决定，
  ; 实际为 aiasys，不是 productName（AIASys），也不是安装目录名。
  MessageBox MB_YESNO|MB_ICONQUESTION "是否同时删除用户数据（工作区文件、会话历史、日志、本地数据库）？选择「是」将彻底删除 %APPDATA%\aiasys 下的所有数据。选择「否」仅卸载程序，保留用户数据。" IDYES deleteData IDNO keepData

deleteData:
  ; Electron 始终把用户数据写在 per-user 的 Roaming 下；卸载时强制切到 current 上下文，
  ; 避免 per-machine 安装时 $APPDATA 指向 ProgramData 而漏删。
  SetShellVarContext current
  RMDir /r "$APPDATA\aiasys"
  DetailPrint "已删除用户数据"
  Goto dataDone

keepData:
  DetailPrint "保留用户数据"

dataDone:
!macroend
