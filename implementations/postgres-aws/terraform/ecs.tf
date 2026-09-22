resource "aws_security_group" "ecs_tasks" {
  name_prefix = "${local.name_prefix}-ecs-tasks-"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = var.server_container_port
    to_port         = var.server_container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-ecs-tasks" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_ecs_cluster" "main" {
  name = local.name_prefix
}

resource "aws_cloudwatch_log_group" "server" {
  name              = "/ecs/${local.name_prefix}-server"
  retention_in_days = 14
}

resource "aws_ecs_task_definition" "server" {
  family                   = "${local.name_prefix}-server"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name  = "server"
      image = "${aws_ecr_repository.server.repository_url}:${var.server_image_tag}"
      portMappings = [
        { containerPort = var.server_container_port, protocol = "tcp" },
      ]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = tostring(var.server_container_port) },
        { name = "GOOGLE_CALLBACK_URL", value = "http://${aws_lb.main.dns_name}/auth/google/callback" },
      ]
      secrets = [
        { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.db.arn}:url::" },
        { name = "SESSION_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:session_secret::" },
        { name = "GOOGLE_CLIENT_ID", valueFrom = "${aws_secretsmanager_secret.app.arn}:google_client_id::" },
        { name = "GOOGLE_CLIENT_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:google_client_secret::" },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.server.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "server"
        }
      }
    }
  ])
}

# desired_count fixed at 1 — no autoscaling policy yet (see MAPPING.md).
resource "aws_ecs_service" "server" {
  name            = "${local.name_prefix}-server"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.server.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.server.arn
    container_name   = "server"
    container_port   = var.server_container_port
  }

  depends_on = [aws_lb_listener.http]
}
