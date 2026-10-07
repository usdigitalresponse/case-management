variable "aws_profile" {
  description = "Named AWS CLI profile to deploy with."
  type        = string
}

variable "aws_region" {
  description = "AWS region."
  type        = string
  default     = "us-east-1"
}

variable "name" {
  description = "Name prefix and Project tag for every resource."
  type        = string
  default     = "case-mgmt-demo"
}

variable "instance_type" {
  description = "Graviton (arm64) instance type; images are built for linux/arm64."
  type        = string
  default     = "t4g.micro"
}

variable "root_volume_gb" {
  description = "Root EBS volume size (gp3)."
  type        = number
  default     = 12
}

variable "ssh_public_key_path" {
  description = "Public key installed for ec2-user."
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "ssh_cidr" {
  description = "CIDR allowed to SSH in, normally your own IP as x.x.x.x/32."
  type        = string
}

variable "alert_email" {
  description = "Email notified when forecast monthly spend passes budget_usd."
  type        = string
}

variable "budget_usd" {
  description = "Monthly AWS Budgets alert threshold, in USD."
  type        = number
  default     = 20
}
