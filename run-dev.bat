@echo off
chcp 65001 >nul
title YT Live Wallpaper — запуск для разработки
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

if not exist node_modules (
    echo  Первый запуск: устанавливаю зависимости...
    call npm install
    if errorlevel 1 (
        echo  [ОШИБКА] npm install завершился с ошибкой. Текст выше.
        pause
        exit /b 1
    )
)

echo  Запускаю приложение...
call npm start
