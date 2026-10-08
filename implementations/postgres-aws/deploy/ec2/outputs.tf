output "public_ip" {
  value = aws_eip.app.public_ip
}

output "hostname" {
  description = "sslip.io name resolving to public_ip; Caddy gets its HTTPS certificate for this."
  value       = "${replace(aws_eip.app.public_ip, ".", "-")}.sslip.io"
}

output "url" {
  value = "https://${replace(aws_eip.app.public_ip, ".", "-")}.sslip.io"
}

output "ssh" {
  value = "ssh ec2-user@${aws_eip.app.public_ip}"
}
