#!/usr/bin/env bash
# Builds the production images locally for linux/arm64, copies them to the
# instance over SSH (no registry), and (re)starts docker-compose.prod.yml.
# Keeps all data; never seeds. Run from anywhere after `terraform apply`.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
app_root="$(cd "$here/../.." && pwd)"
compose_file="$app_root/docker-compose.prod.yml"

host="$(terraform -chdir="$here" output -raw hostname)"
ip="$(terraform -chdir="$here" output -raw public_ip)"
target="ec2-user@$ip"
ssh_opts=(-o StrictHostKeyChecking=accept-new)

echo "==> Waiting for first-boot setup on $ip"
for _ in $(seq 1 30); do
  ssh "${ssh_opts[@]}" -o ConnectTimeout=5 "$target" true 2>/dev/null && break
  sleep 5
done
ssh "${ssh_opts[@]}" "$target" 'cloud-init status --wait >/dev/null'

echo "==> Building images (linux/arm64)"
# The secrets only satisfy the compose file's required variables; build
# doesn't use them. /dev/null keeps the dev .env out of interpolation.
DOCKER_DEFAULT_PLATFORM=linux/arm64 POSTGRES_PASSWORD=unused SESSION_SECRET=unused \
  docker compose -f "$compose_file" --env-file /dev/null build

echo "==> Copying images and compose file"
docker save case-management-server case-management-web | gzip | ssh "${ssh_opts[@]}" "$target" 'gunzip | docker load'
scp "${ssh_opts[@]}" "$compose_file" "$target:app/docker-compose.prod.yml"

# Secrets are generated on the instance on first deploy and never leave it.
ssh "${ssh_opts[@]}" "$target" bash -s -- "$host" <<'REMOTE'
set -euo pipefail
cd ~/app
if [ ! -f .env.prod ]; then
  umask 077
  cat > .env.prod <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)
SITE_ADDRESS=$1
APP_BASE_URL=https://$1
EXTERNAL_EMAIL_WHITELIST=
EOF
fi
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --no-build --remove-orphans
docker image prune -f >/dev/null
REMOTE

echo "==> Waiting for https://$host/healthz"
for _ in $(seq 1 60); do
  if curl -fsS "https://$host/healthz" >/dev/null 2>&1; then
    echo "Deployed: https://$host"
    exit 0
  fi
  sleep 5
done
echo "Not healthy after 5 minutes; check: ssh $target 'cd app && docker compose -f docker-compose.prod.yml logs'" >&2
exit 1
