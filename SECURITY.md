# Security Policy

## Supported Versions

This is a **study/learning project** and is not intended for production use. No versions are officially supported for security updates.

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |

## Reporting a Vulnerability

Since this is an educational project:

1. **For learning purposes**: If you find a security issue, please open a GitHub Issue to discuss it openly. This helps everyone learn from the discovery.

2. **What to include**:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Security Best Practices in This Project

This project follows these security practices:

- **JWT Authentication**: Uses asymmetric EdDSA with JWKS (see [ADR 0003](docs/adr/0003-asymmetric-jwt-eddsa-with-jwks.md))
- **Input Validation**: All API inputs are validated
- **SQL Injection Prevention**: Uses parameterized queries via sqlc
- **Dependency Management**: Regular dependency updates via Dependabot/Renovate
- **No Secrets in Code**: All secrets managed via environment variables

## Disclaimer

This is a **study project** for learning purposes. It should not be used in production environments without additional security hardening and review.
