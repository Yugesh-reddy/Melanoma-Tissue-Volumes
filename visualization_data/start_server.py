"""
Simple HTTP server to run Three.js viewer
Run this script and open http://localhost:8000/threejs_volume_viewer.html in your browser
"""
import http.server
import socketserver
import os
from pathlib import Path

PORT = 8000

# Change to script directory
script_dir = Path(__file__).parent
os.chdir(script_dir)

Handler = http.server.SimpleHTTPRequestHandler

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Server started at http://localhost:{PORT}")
    print(f"Serving files from: {script_dir}")
    print(f"\nOpen in browser:")
    print(f"  http://localhost:{PORT}/threejs_volume_viewer.html")
    print(f"\nPress Ctrl+C to stop the server")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")

