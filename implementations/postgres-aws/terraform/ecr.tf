# No CI/CD builds and pushes an image here yet (see MAPPING.md) — this repo
# only exists so the ECS task definition below has somewhere to reference;
# push a production image manually before the service can start.
resource "aws_ecr_repository" "server" {
  name                 = "${local.name_prefix}-server"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}
