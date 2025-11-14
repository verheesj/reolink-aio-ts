# Publishing Guide for reolink-aio

This guide covers the steps to publish the `reolink-aio` package to npm and manage GitHub releases.

## Pre-publish Checklist

Before publishing, ensure:

- [x] All tests pass (`npm test`)
- [x] Build completes successfully (`npm run build`)
- [x] Version follows semver pre-release format (e.g., `0.1.0-alpha.0`)
- [x] CHANGELOG.md is updated with release notes
- [x] README.md reflects current features and installation
- [x] .npmignore excludes development files
- [x] package.json metadata is correct
- [x] No sensitive data in examples or code

## Package Configuration

### Current Status
- **Package Name**: `reolink-aio`
- **Version**: `0.1.0-alpha.0`
- **Dist Tag**: `next` (pre-release)
- **License**: MIT
- **Repository**: https://github.com/verheesj/reolink-aio-ts

### What Gets Published

The npm package includes:
- `dist/esm/` - ES Module build
- `dist/cjs/` - CommonJS build  
- `dist/types/` - TypeScript declarations
- `README.md` - Documentation
- `CHANGELOG.md` - Release history
- `LICENSE` - License file

Excluded from package:
- Source files (`src/`)
- Tests and test files
- Examples
- Development configs
- Build artifacts

## GitHub Setup

### 1. Create NPM Access Token

1. Go to [npmjs.com](https://www.npmjs.com) and log in
2. Click your profile → "Access Tokens" → "Generate New Token"
3. Select **"Automation"** or **"Publish"** type
4. Set appropriate scope/permissions
5. Copy the token (you won't see it again!)

### 2. Add NPM_TOKEN to GitHub Secrets

1. Go to your GitHub repository: https://github.com/verheesj/reolink-aio-ts
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **"New repository secret"**
4. Name: `NPM_TOKEN`
5. Value: Paste your npm token
6. Click **"Add secret"**

### 3. Verify GitHub Actions Workflow

The workflow at `.github/workflows/publish.yml` is already configured to:
- Trigger on GitHub Release publication
- Run tests and build
- Publish to npm with provenance
- Use the `next` dist-tag for pre-releases

## Publishing Process

### Option 1: Automated via GitHub Release (Recommended)

1. **Update version** (if needed):
   ```bash
   # For next alpha release
   npm version prerelease --preid=alpha
   
   # For next beta release
   npm version prerelease --preid=beta
   
   # This updates package.json and creates a git tag
   ```

2. **Update CHANGELOG.md** with new version details

3. **Commit and push**:
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore: bump version to $(node -p "require('./package.json').version")"
   git push origin main
   git push origin --tags
   ```

4. **Create GitHub Release**:
   - Go to https://github.com/verheesj/reolink-aio-ts/releases/new
   - Tag: Use the version tag (e.g., `v0.1.0-alpha.0`)
   - Title: Same as tag (e.g., `v0.1.0-alpha.0`)
   - Description: Copy relevant section from CHANGELOG.md
   - Check **"Set as a pre-release"** for alpha/beta versions
   - Click **"Publish release"**

5. **Monitor the workflow**:
   - Go to **Actions** tab in GitHub
   - Watch the "Publish to npm" workflow
   - Verify it completes successfully

6. **Verify publication**:
   ```bash
   npm view reolink-aio@next
   ```

### Option 2: Manual Publish (Not Recommended)

Only use this if automated publishing fails:

```bash
# Clean and rebuild
npm run clean
npm run build

# Run tests
npm test

# Dry run to preview
npm pack --dry-run

# Publish with provenance
npm publish --tag next --access public

# Note: Without provenance, security/trust is reduced
```

## Version Management

### Pre-release Versions (Current Phase)

For alpha releases:
```bash
# First alpha: 0.1.0-alpha.0
# Next alpha: 0.1.0-alpha.1
npm version prerelease --preid=alpha
```

For beta releases:
```bash
# First beta: 0.1.0-beta.0
npm version prerelease --preid=beta
```

### Stable Release (Future)

When ready for stable 1.0.0:

1. Update version:
   ```bash
   npm version 1.0.0
   ```

2. Update package.json to remove or change `publishConfig.tag`:
   ```json
   "publishConfig": { "tag": "latest" }
   ```

3. Update README.md installation to:
   ```bash
   npm install reolink-aio
   ```

4. Create GitHub Release without "pre-release" checkbox

## Installation for Users

### Pre-release (Current)
```bash
# Install latest pre-release
npm install reolink-aio@next

# Install specific version
npm install reolink-aio@0.1.0-alpha.0
```

### Stable (Future)
```bash
npm install reolink-aio
```

## Troubleshooting

### Workflow Fails with "401 Unauthorized"
- Verify NPM_TOKEN is set correctly in GitHub Secrets
- Ensure token has publish permissions
- Check token hasn't expired

### Version Already Published
- Increment version before publishing
- Use `npm version` commands to manage versions
- Never re-publish the same version

### Tests Fail in Workflow
- Run tests locally first: `npm test`
- Check CI logs for specific failures
- Ensure dependencies are locked in package-lock.json

### Wrong Dist Tag
- Pre-releases should use `next` tag
- Stable releases use `latest` tag
- Change via `publishConfig.tag` in package.json

## Post-publish Tasks

After successful publication:

1. **Announce the release**:
   - Update project homepage
   - Social media/community announcements
   - Add to package manager directories

2. **Monitor for issues**:
   - Check npm download stats
   - Watch GitHub issues
   - Monitor community feedback

3. **Plan next release**:
   - Review TODO list in README
   - Update roadmap
   - Set milestones for next version

## Quick Reference Commands

```bash
# Build
npm run build

# Test
npm test

# Preview package
npm pack --dry-run

# Bump version (alpha)
npm version prerelease --preid=alpha

# Bump version (beta)
npm version prerelease --preid=beta

# Check published versions
npm view reolink-aio versions

# Check latest pre-release
npm view reolink-aio@next

# Check latest stable
npm view reolink-aio@latest
```

## Resources

- [npm Publishing Guide](https://docs.npmjs.com/cli/v10/commands/npm-publish)
- [Semantic Versioning](https://semver.org/)
- [GitHub Actions for npm](https://docs.github.com/en/actions/publishing-packages/publishing-nodejs-packages)
- [npm Provenance](https://docs.npmjs.com/generating-provenance-statements)
