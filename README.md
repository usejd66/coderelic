# CodeRelic

CodeRelic is a CLI tool that helps developers identify code that may have been abandoned in a Git repository.

Instead of assuming that old code is unused, CodeRelic combines multiple signals to provide evidence about whether code may still be active.

## What It Checks

CodeRelic currently analyzes:

- Git history
- Import relationships
- Test references
- Feature / area structure
- Framework and runtime signals
- Abandonment evidence scores

## Installation

Clone the repository:

```bash
git clone https://github.com/usejd66/coderelic.git
cd coderelic
npm install
npm link