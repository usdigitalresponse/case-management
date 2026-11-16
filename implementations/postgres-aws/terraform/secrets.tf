resource "random_password" "session_secret" {
  length  = 48
  special = false
}

# OAuth credentials start empty; with demo sign-in off in production, nobody can sign in until they are put in
# (`aws secretsmanager put-secret-value`) and the service restarted (MAPPING.md).
resource "aws_secretsmanager_secret" "app" {
  name = "${local.name_prefix}-app"
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    session_secret       = random_password.session_secret.result
    google_client_id     = ""
    google_client_secret = ""
  })

  lifecycle {
    # Keeps values filled in after apply.
    ignore_changes = [secret_string]
  }
}
