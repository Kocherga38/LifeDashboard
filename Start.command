#!/bin/bash
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.volta/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  source "$HOME/.nvm/nvm.sh"
fi
if ! command -v node >/dev/null 2>&1; then
  echo 'Установи Node.js 24 LTS: https://nodejs.org/en/download'
  read -r -p 'Нажми Enter, чтобы закрыть окно.'
  exit 1
fi
node scripts/start.mjs
if [ "$?" -ne 0 ]; then read -r -p 'Нажми Enter, чтобы закрыть окно.'; fi
