#!/usr/bin/env bash
set -e

echo "Checking for Node.js..."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Installing via nvm..."

  # Install nvm if missing
  if [ ! -d "$HOME/.nvm" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  fi

  # Load nvm
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1090
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

  echo "Installing Node.js (LTS)..."
  nvm install --lts
  nvm use --lts
else
  echo "Node.js already installed: $(node -v)"
fi

echo "🔍 Checking for npm..."
if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Something is wrong with the Node installation."
  exit 1
fi

echo "npm available: $(npm -v)"

echo "Installing project dependencies..."
npm install puppeteer pdf-lib

echo "Setup complete!"
