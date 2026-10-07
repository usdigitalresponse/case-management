resource "random_password" "session_secret" {
  length  = 48
  special = false
}

# Google OAuth credentials start empty (Terraform can't know them). Until
# someone fills these in (`aws secretsmanager put-secret-value`) and
# restarts the service, only the always-on /auth/demo-login works — see
# MAPPING.md.
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
    # Preserve values filled in manually after apply (see comment above) —
    # Terraform shouldn't blank them out on a later apply.
    ignore_changes = [secret_string]
  }
}
