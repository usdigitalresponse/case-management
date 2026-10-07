# Single-EC2 demo deployment

Runs `../../docker-compose.prod.yml` on one t4g.micro in the account's
default VPC, for a synthetic-data demo with a handful of users. Sign-in is
the always-on demo sign-in; no SSO or SES. About $11/month in us-east-1:
instance (~$6), public IPv4 (~$3.65), 12 GB gp3 (~$1), weekly snapshots.

Terraform creates the instance, an Elastic IP, a security group (80/443
open, 22 from `ssh_cidr` only), an SSH key pair, a weekly snapshot policy
(keeps 4) and a monthly budget alert. HTTPS comes from Caddy and Let's
Encrypt on the free `<ip-with-dashes>.sslip.io` hostname; no domain needed.

## Provision

Requires Terraform, Docker, an AWS CLI profile and `~/.ssh/id_ed25519.pub`.

```sh
cp terraform.tfvars.example terraform.tfvars   # gitignored; fill in
terraform init
terraform plan -out=demo.tfplan                # review before applying
terraform apply demo.tfplan
```

## Deploy (first time and every update)

```sh
./deploy.sh
```

Builds the images locally for linux/arm64, copies them over SSH, and
restarts the stack. It generates the instance's database password and
session secret on first deploy, on the instance only (`~/app/.env.prod`).
Deploys keep all data.

## Seed or reset demo data

Destructive: deletes everything, including records users entered.

```sh
ssh ec2-user@$(terraform output -raw public_ip) \
  'cd app && docker compose -f docker-compose.prod.yml --env-file .env.prod exec server node dist/src/db/seed.js'
```

## Operate

- Logs: `ssh ec2-user@<ip> 'cd app && docker compose -f docker-compose.prod.yml logs --tail 100'`
- Your IP changed (SSH times out): update `ssh_cidr`, then plan and apply.
- Pause: stop the instance in the EC2 console; the IP and data remain, and
  only the IP and disk keep billing (~$5/month).
- Tear down everything, including all data:
  `terraform destroy`. Snapshots taken by the policy are not managed by Terraform;
  delete any leftovers in the EC2 console.

The instance ignores AMI and `user_data.sh` changes after creation, so
`apply` never replaces it (which would destroy the database).
