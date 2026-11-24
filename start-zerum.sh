#!/usr/bin/env bash
set -e
cd /home/wsl-user/workspace/repos/users/nescaau/cold-click/zerum
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
npm run dev
