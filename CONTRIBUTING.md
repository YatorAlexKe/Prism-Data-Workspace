# Contributing to Prism

## Branching Strategy

```
main          ← stable, production-ready
  └── develop ← integration branch
        ├── feature/your-feature  ← your work
        └── feature/other-work    ← other features
```

## Workflow

```bash
# 1. Always start from develop
git checkout develop
git pull origin develop

# 2. Create a feature branch
git checkout -b feature/your-feature-name

# 3. Make your changes
git add .
git commit -m "Clear description of what changed"

# 4. Push your branch
git push origin feature/your-feature-name

# 5. Create Pull Request on GitHub
# feature/your-feature-name → develop
# (never push directly to main)
```

## Pull Request Rules

- All PRs go to `develop` first — never directly to `main`
- Test your changes locally before creating a PR
- Write a clear PR title and description
- `main` is only updated when `develop` is stable and tested

## Frontend Changes

After any frontend changes:
```bash
cd frontend
npm run build
```

Always rebuild before testing or committing.

## Commit Message Format

```
Add feature X
Fix bug in Y
Update Z to handle edge case
Remove unused code from W
```

Keep it short and clear. Start with a verb.
