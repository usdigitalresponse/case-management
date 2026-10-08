#!/bin/bash
# First-boot setup (Amazon Linux 2023). Runs once; deploy.sh waits for it.
set -euxo pipefail

# Headroom for a 1 GB instance.
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap defaults 0 0' >> /etc/fstab

dnf install -y docker
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \
  "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)"
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
systemctl enable --now docker
usermod -aG docker ec2-user

install -d -o ec2-user -g ec2-user /home/ec2-user/app
