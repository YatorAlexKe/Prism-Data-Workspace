# Security Policy

## SQL Security

All SQL queries are validated before execution:

| Operation | Status |
|-----------|--------|
| SELECT | ✅ Allowed |
| DROP | ❌ Blocked |
| DELETE | ❌ Blocked |
| INSERT | ❌ Blocked |
| UPDATE | ❌ Blocked |
| ALTER | ❌ Blocked |
| PRAGMA | ❌ Blocked |

## MySQL Connection Security

- Passwords are encrypted using **Fernet symmetric encryption**
- Encryption key stored in `database/prism.key` (never committed to Git)
- Read-only session enforced: `SET SESSION TRANSACTION READ ONLY`
- 30-second query timeout
- 10,000 row result limit

## Credential Protection

Files protected by `.gitignore` — never committed to GitHub:
```
credentials/          ← Google service account keys
database/prism.key    ← Encryption key
database/prism.db     ← Local database
.env                  ← Environment variables
```

## Reporting Vulnerabilities

If you discover a security vulnerability, please do not open a public GitHub issue.
Contact the maintainers directly.
