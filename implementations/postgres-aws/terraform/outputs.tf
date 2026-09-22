output "alb_dns_name" {
  description = "API base URL (HTTP only — see MAPPING.md)."
  value       = aws_lb.main.dns_name
}

output "cloudfront_domain_name" {
  description = "Client base URL."
  value       = aws_cloudfront_distribution.client.domain_name
}

output "client_bucket_name" {
  description = "Sync the client build here, e.g. aws s3 sync client/dist/ s3://<this>/"
  value       = aws_s3_bucket.client.bucket
}

output "ecr_repository_url" {
  description = "Push the server image here before the ECS service can start."
  value       = aws_ecr_repository.server.repository_url
}

output "db_secret_arn" {
  description = "Secrets Manager secret holding DB connection details."
  value       = aws_secretsmanager_secret.db.arn
}

output "app_secret_arn" {
  description = "Secrets Manager secret holding SESSION_SECRET and Google OAuth credentials (fill in the latter manually)."
  value       = aws_secretsmanager_secret.app.arn
}
