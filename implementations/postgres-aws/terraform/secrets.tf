resource "random_password" "session_secret" {
  length  = 48
  special = false
}

# Google OAuth credentials start empty (Terraform can't know them). Since
# NODE_ENV=production also disables /auth/dev-login, nothing can log in
# until someone fills these in (`aws secretsmanager put-secret-value`) and
# restarts the service — see MAPPING.md, this is the one gap that blocks
# using a freshly-applied environment at all.
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
