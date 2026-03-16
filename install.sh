#!/usr/bin/env bash
set -euo pipefail

APP_NAME="idlescreens-pro"
APP_USER="${APP_USER:-idlescreens}"
APP_GROUP="${APP_GROUP:-idlescreens}"
INSTALL_DIR="${INSTALL_DIR:-/opt/idlescreens-pro}"
SERVICE_NAME="${SERVICE_NAME:-idlescreens-pro}"
PORT="${PORT:-3010}"
CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root:"
  echo "  sudo bash install.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "==> Installing system packages"
apt-get update
apt-get install -y ca-certificates curl gnupg rsync unzip build-essential sqlite3

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 20 ]]; then
  echo "==> Installing Node.js 20"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi

if ! getent group "$APP_GROUP" >/dev/null; then
  groupadd --system "$APP_GROUP"
fi

if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --gid "$APP_GROUP" --home-dir "$INSTALL_DIR" --create-home --shell /usr/sbin/nologin "$APP_USER"
fi

echo "==> Copying app to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
rsync -a --delete   --exclude node_modules   --exclude .git   --exclude data/*.db-shm   --exclude data/*.db-wal   "$CURRENT_DIR"/ "$INSTALL_DIR"/

mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/uploads"
chown -R "$APP_USER:$APP_GROUP" "$INSTALL_DIR"

echo "==> Installing npm dependencies"
cd "$INSTALL_DIR"
sudo -u "$APP_USER" npm install --omit=dev

echo "==> Writing environment file"
cat > /etc/${SERVICE_NAME}.env <<EOF
PORT=${PORT}
NODE_ENV=production
EOF

echo "==> Creating systemd service"
cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=IdleScreens Pro Digital Signage
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=/etc/${SERVICE_NAME}.env
ExecStart=/usr/bin/env node server.js
Restart=always
RestartSec=5
KillSignal=SIGINT

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}"

echo
echo "IdleScreens Pro installed."
echo "Service: ${SERVICE_NAME}"
echo "Status:  systemctl status ${SERVICE_NAME}"
echo "Logs:    journalctl -u ${SERVICE_NAME} -f"
echo "URL:     http://$(hostname -I | awk '{print $1}'):${PORT}/admin"
