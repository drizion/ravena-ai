#!/bin/bash
# update-ytdl.sh - Update yt-dlp binary for youtube-dl-exec

# Configuration
YTDL_BIN="./node_modules/youtube-dl-exec/bin/yt-dlp"
COOKIES_FILE="./data/www.youtube.com_cookies.txt"
TEST_VIDEO_URL="https://www.youtube.com/watch?v=dQw4w9WgXcQ" # Never Gonna Give You Up

echo "============================================"
echo "   Youtube-dl-exec (yt-dlp) Update Script"
echo "============================================"

# Check if binary exists, if not try to download it
if [ ! -f "$YTDL_BIN" ]; then
    echo "[!] yt-dlp binary not found at $YTDL_BIN"
    echo "[*] Attempting to download it via youtube-dl-exec postinstall..."
    node node_modules/youtube-dl-exec/scripts/postinstall.js
fi

if [ -f "$YTDL_BIN" ]; then
    echo "[*] Current version:"
    "$YTDL_BIN" --version

    echo "[*] Updating yt-dlp..."
    "$YTDL_BIN" -U

    echo "[*] New version:"
    "$YTDL_BIN" --version

    # Test with cookies
    if [ -f "$COOKIES_FILE" ]; then
        echo "[*] Testing yt-dlp with cookies file: $COOKIES_FILE"
        VIDEO_ID=$("$YTDL_BIN" --cookies "$COOKIES_FILE" --get-id "$TEST_VIDEO_URL" --quiet 2>/dev/null)
        
        if [ "$VIDEO_ID" == "dQw4w9WgXcQ" ]; then
            echo "[+] Success: yt-dlp is working correctly with the provided cookies."
        else
            echo "[-] Error: yt-dlp test failed. Cookies might be expired or invalid."
            echo "    Make sure to update $COOKIES_FILE with fresh cookies from your browser."
        fi
    else
        echo "[!] Warning: Cookies file not found at $COOKIES_FILE"
        echo "    Falling back to no-cookies test..."
        "$YTDL_BIN" --get-id "$TEST_VIDEO_URL" --quiet > /dev/null
        if [ $? -eq 0 ]; then
            echo "[+] Success: yt-dlp is working (without cookies)."
        else
            echo "[-] Error: yt-dlp test failed even without cookies."
        fi
    fi
else
    echo "[-] Fatal Error: Could not find or download yt-dlp binary."
    echo "    Try running: npm install youtube-dl-exec"
    exit 1
fi

echo "============================================"
echo "   Update Complete"
echo "============================================"
