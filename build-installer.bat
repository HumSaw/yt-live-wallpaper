@echo off
chcp 65001 >nul
title YT Live Wallpaper — сборка установщика
echo.
echo  ============================================
echo   Сборка установщика YT Live Wallpaper
echo  ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo  [ОШИБКА] Node.js не найден.
    echo  Скачайте LTS-версию с https://nodejs.org и установите,
    echo  затем запустите этот файл снова.
    echo.
    pause
    exit /b 1
)

echo  [1/3] Устанавливаю зависимости...
call npm install
if errorlevel 1 (
    echo  [ОШИБКА] npm install завершился с ошибкой. Текст выше.
    pause
    exit /b 1
)

echo.
echo  [2/3] Скачиваю yt-dlp и ffmpeg (запакуются в установщик)...
call npm run setup
if errorlevel 1 (
    echo  [ПРЕДУПРЕЖДЕНИЕ] Не удалось скачать бинарники.
    echo  Не страшно: приложение докачает их само при первом запуске.
)

echo.
echo  [3/3] Собираю установщик...
call npm run dist
if errorlevel 1 (
    echo  [ОШИБКА] Сборка не удалась. Текст ошибки выше.
    pause
    exit /b 1
)

echo.
echo  ============================================
echo   ГОТОВО!
echo   Установщик лежит в папке dist\
echo   Файл: YT-Live-Wallpaper-Setup-*.exe
echo  ============================================
echo.
echo  Открываю папку dist...
start "" explorer "%~dp0dist"
pause
