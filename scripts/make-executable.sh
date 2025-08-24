#!/bin/bash

# Make all Node.js scripts in the scripts directory executable

echo "Making scripts executable..."

chmod +x scripts/*.js
chmod +x scripts/*.sh

echo "✅ All scripts are now executable"
echo ""
echo "You can now run scripts directly:"
echo "  ./scripts/watch.js"
echo "  ./scripts/package.js"
echo "  ./scripts/dev-help.js"
echo ""
echo "Or use npm scripts:"
echo "  npm run dev"
echo "  npm run package"
echo "  npm run help"