resource "random_password" "db" {
  length  = 32
  special = false # avoid characters that need escaping in a connection-string URL
}

# One secret with everything createDb()/migrate/seed need — see
# ../server/src/db/client.ts. Read by the ECS task via its execution role
# (see iam.tf), not committed anywhere.
resource "aws_secretsmanager_secret" "db" {
  name = "${local.name_prefix}-db"
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    username = "postgres"
    password = random_password.db.result
    host     = aws_db_instance.main.address
    port     = aws_db_instance.main.port
    dbname   = var.db_name
    url      = "postgres://postgres:${random_password.db.result}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${var.db_name}"
  })
}

resource "aws_db_subnet_group" "main" {
  name       = local.name_prefix
  subnet_ids = aws_subnet.private[*].id

  tags = { Name = local.name_prefix }
}

resource "aws_security_group" "rds" {
  name_prefix = "${local.name_prefix}-rds-"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-rds" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group_rule" "rds_from_ecs" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.rds.id
  source_security_group_id = aws_security_group.ecs_tasks.id
}

# Single instance, no Multi-AZ — a documented gap for production hardening
# (see MAPPING.md), acceptable for a sandbox environment.
resource "aws_db_instance" "main" {
  identifier     = local.name_prefix
  engine         = "postgres"
  engine_version = "15"
  instance_class = var.db_instance_class

  allocated_storage = 20
  storage_type      = "gp3"

  db_name  = var.db_name
  username = "postgres"
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false

  skip_final_snapshot = true
  # Sandbox-appropriate; revisit (skip_final_snapshot=false, a real
  # final_snapshot_identifier, and deletion_protection) before this
  # instance holds anything but synthetic data.

  tags = { Name = local.name_prefix }
}
