#!/bin/bash
# Quick publish script for reolink-aio
# This script helps automate the GitHub release process

set -e  # Exit on error

echo "🎯 reolink-aio Publishing Helper"
echo "=================================="
echo ""

# Check if on main branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
    echo "⚠️  Warning: You're on branch '$BRANCH', not 'main'"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "📦 Current version: $CURRENT_VERSION"
echo ""

# Ask what to do
echo "What would you like to do?"
echo "1) Prepare for release (build + test)"
echo "2) Bump version (alpha)"
echo "3) Bump version (beta)"
echo "4) Create git tag and push"
echo "5) Open GitHub releases page"
echo "6) Verify published package"
echo "7) Full release workflow (1-4)"
echo "0) Exit"
echo ""
read -p "Choose option: " OPTION

case $OPTION in
    1)
        echo ""
        echo "🧹 Cleaning..."
        npm run clean
        
        echo ""
        echo "🔨 Building..."
        npm run build
        
        echo ""
        echo "🧪 Testing..."
        npm test
        
        echo ""
        echo "📦 Package preview..."
        npm pack --dry-run | tail -6
        
        echo ""
        echo "✅ Ready for release!"
        ;;
    
    2)
        echo ""
        npm version prerelease --preid=alpha
        NEW_VERSION=$(node -p "require('./package.json').version")
        echo "✅ Version bumped to $NEW_VERSION"
        echo "📝 Don't forget to update CHANGELOG.md!"
        ;;
    
    3)
        echo ""
        npm version prerelease --preid=beta
        NEW_VERSION=$(node -p "require('./package.json').version")
        echo "✅ Version bumped to $NEW_VERSION"
        echo "📝 Don't forget to update CHANGELOG.md!"
        ;;
    
    4)
        VERSION=$(node -p "require('./package.json').version")
        TAG="v$VERSION"
        
        echo ""
        echo "📝 Committing changes..."
        git add package.json package-lock.json CHANGELOG.md
        git commit -m "chore: release $VERSION" || echo "No changes to commit"
        
        echo ""
        echo "🏷️  Creating tag $TAG..."
        git tag -a "$TAG" -m "Release $VERSION"
        
        echo ""
        echo "⬆️  Pushing to GitHub..."
        git push origin main
        git push origin "$TAG"
        
        echo ""
        echo "✅ Tag created and pushed!"
        echo "🎯 Next: Create GitHub Release at:"
        echo "   https://github.com/verheesj/reolink-aio-ts/releases/new?tag=$TAG"
        ;;
    
    5)
        VERSION=$(node -p "require('./package.json').version")
        TAG="v$VERSION"
        URL="https://github.com/verheesj/reolink-aio-ts/releases/new?tag=$TAG"
        
        echo ""
        echo "🌐 Opening GitHub releases page..."
        echo "   $URL"
        
        if command -v open &> /dev/null; then
            open "$URL"
        elif command -v xdg-open &> /dev/null; then
            xdg-open "$URL"
        else
            echo "   Please open manually in your browser"
        fi
        ;;
    
    6)
        echo ""
        echo "🔍 Checking npm registry..."
        echo ""
        echo "Latest pre-release (@next):"
        npm view reolink-aio@next version 2>/dev/null || echo "Not published yet"
        echo ""
        echo "All versions:"
        npm view reolink-aio versions 2>/dev/null || echo "Package not published yet"
        ;;
    
    7)
        echo ""
        echo "🚀 Starting full release workflow..."
        echo ""
        
        # Step 1: Clean and build
        echo "Step 1/4: Clean and build..."
        npm run clean
        npm run build
        
        # Step 2: Test
        echo ""
        echo "Step 2/4: Testing..."
        npm test
        
        # Step 3: Bump version
        echo ""
        echo "Step 3/4: Version bump..."
        read -p "Bump to (a)lpha or (b)eta? " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Aa]$ ]]; then
            npm version prerelease --preid=alpha
        elif [[ $REPLY =~ ^[Bb]$ ]]; then
            npm version prerelease --preid=beta
        else
            echo "Invalid choice, skipping version bump"
        fi
        
        NEW_VERSION=$(node -p "require('./package.json').version")
        echo "Version: $NEW_VERSION"
        
        # Step 4: Git operations
        echo ""
        echo "Step 4/4: Git tag and push..."
        read -p "Update CHANGELOG.md now, then press enter to continue..."
        
        TAG="v$NEW_VERSION"
        git add package.json package-lock.json CHANGELOG.md
        git commit -m "chore: release $NEW_VERSION"
        git tag -a "$TAG" -m "Release $NEW_VERSION"
        git push origin main
        git push origin "$TAG"
        
        echo ""
        echo "✅ Release prepared!"
        echo "🎯 Final step: Create GitHub Release"
        echo "   https://github.com/verheesj/reolink-aio-ts/releases/new?tag=$TAG"
        
        if command -v open &> /dev/null; then
            read -p "Open release page now? (y/n) " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                open "https://github.com/verheesj/reolink-aio-ts/releases/new?tag=$TAG"
            fi
        fi
        ;;
    
    0)
        echo "Goodbye!"
        exit 0
        ;;
    
    *)
        echo "Invalid option"
        exit 1
        ;;
esac

echo ""
echo "Done! 🎉"
