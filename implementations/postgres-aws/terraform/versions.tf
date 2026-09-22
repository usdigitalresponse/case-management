terraform {
  required_version = ">= 1.14"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # No remote backend configured yet — state is local until a real
  # deployment happens. See MAPPING.md: remote state (S3 + DynamoDB lock,
  # matching usdr-gost's *.s3.tfbackend convention) is a deferred decision,
  # not yet a concrete need.
}
