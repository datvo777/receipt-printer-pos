#!/bin/bash
# Mac/Linux: bấm đúp file này để chạy app (lần đầu có thể cần: chmod +x start.command)
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Chưa cài Node.js. Vào https://nodejs.org tải bản LTS, cài xong chạy lại."
  read -n 1 -s -r -p "Bấm phím bất kỳ để đóng..."
  exit 1
fi
while true; do
  node server.js
  [ $? -eq 2 ] && { echo "App đang chạy ở cửa sổ khác."; read -n 1 -s -r -p "Bấm phím bất kỳ để đóng..."; exit 2; }
  echo; echo "App bị dừng, tự khởi động lại sau 3 giây..."; sleep 3
done
