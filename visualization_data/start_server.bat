@echo off
echo Starting web server for Three.js viewer...
echo.
echo Open your browser and go to:
echo   http://localhost:8000/threejs_volume_viewer.html
echo.
echo Press Ctrl+C to stop the server
echo.
cd /d %~dp0
python -m http.server 8000

