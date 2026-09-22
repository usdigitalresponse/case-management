variable "project" {
  description = "Short project name, used as a resource-naming prefix."
  type        = string
  default     = "case-mgmt-pg"
}

variable "environment" {
  description = "Environment name (e.g. sandbox). One environment per tfvars file."
  type        = string
}

variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "availability_zones" {
  description = "Exactly two AZs in aws_region, for the public/private subnet pairs."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "db_name" {
  description = "Postgres database name."
  type        = string
  default     = "case_management_postgres_aws"
}

variable "db_instance_class" {
  description = "RDS instance class. Single instance, no Multi-AZ (see MAPPING.md)."
  type        = string
  default     = "db.t4g.micro"
}

variable "server_image_tag" {
  description = <<-EOT
    Tag to deploy from the server ECR repository. No CI/CD pipeline builds
    and pushes this yet (see MAPPING.md) — push an image manually before
    the ECS service can start successfully.
  EOT
  type        = string
  default     = "latest"
}

variable "server_container_port" {
  description = "Port the server container listens on."
  type        = number
  default     = 3000
}
