#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const command = process.argv[2];

const SOURCE_EXTENSIONS = [
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".mjs",
    ".cjs"
];

const SIX_MONTHS = 180 * 24 * 60 * 60 * 1000;

/**
 * Execute a Git command safely.
 */
function runGit(command) {
    try {
        return execSync(command, {
            encoding: "utf8",
            stdio: ["pipe", "pipe", "ignore"]
        }).trim();
    } catch {
        return null;
    }
}

/**
 * Show CLI help.
 */
function showHelp() {
    console.log(`
CodeRelic

Find code that may have been abandoned.

Usage:
  coderelic scan
  coderelic --help
`);
}

/**
 * Get all tracked files from Git.
 */
function getTrackedFiles() {
    const output = runGit("git ls-files");

    if (!output) {
        return [];
    }

    return output
        .split("\n")
        .map(file => file.trim())
        .filter(Boolean);
}

/**
 * Check if a file is a source file.
 */
function isSourceFile(file) {
    return SOURCE_EXTENSIONS.some(extension =>
        file.endsWith(extension)
    );
}

/**
 * Read a file safely.
 */
function readFile(filePath) {
    try {
        return fs.readFileSync(filePath, "utf8");
    } catch {
        return "";
    }
}

/**
 * Extract relative imports/requires from JavaScript/TypeScript code.
 */
function extractImports(content) {
    const imports = [];

    const patterns = [
        /\bimport\s+(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']/g,
        /\bexport\s+(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']/g,
        /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g
    ];

    for (const pattern of patterns) {
        let match;

        while ((match = pattern.exec(content)) !== null) {
            imports.push(match[1]);
        }
    }

    return imports;
}

/**
 * Resolve a relative import to a tracked file.
 */
function resolveImport(importer, importPath, trackedFilesSet) {
    if (!importPath.startsWith(".")) {
        return null;
    }

    const importerDirectory = path.dirname(importer);

    const basePath = path.normalize(
        path.join(importerDirectory, importPath)
    );

    const candidates = [];

    // Exact path
    candidates.push(basePath);

    // Add common source extensions
    for (const extension of SOURCE_EXTENSIONS) {
        candidates.push(basePath + extension);
    }

    // Directory index files
    for (const extension of SOURCE_EXTENSIONS) {
        candidates.push(
            path.join(basePath, `index${extension}`)
        );
    }

    for (const candidate of candidates) {
        const normalized = candidate.replace(/\\/g, "/");

        if (trackedFilesSet.has(normalized)) {
            return normalized;
        }
    }

    return null;
}

/**
 * Build an import graph.
 */
function buildImportGraph(gitRoot, files) {
    const trackedFilesSet = new Set(files);
    const importedBy = new Map();

    for (const file of files) {
        importedBy.set(file, []);
    }

    for (const importer of files) {
        if (!isSourceFile(importer)) {
            continue;
        }

        const absolutePath = path.join(gitRoot, importer);
        const content = readFile(absolutePath);

        if (!content) {
            continue;
        }

        const imports = extractImports(content);

        for (const importPath of imports) {
            const target = resolveImport(
                importer,
                importPath,
                trackedFilesSet
            );

            if (!target || target === importer) {
                continue;
            }

            const currentImporters = importedBy.get(target);

            if (currentImporters && !currentImporters.includes(importer)) {
                currentImporters.push(importer);
            }
        }
    }

    return importedBy;
}

/**
 * Find old files.
 */
function findOldFiles(gitRoot, files) {
    const now = Date.now();
    const oldFiles = [];

    for (const file of files) {
        const timestamp = runGit(
            `git log -1 --format=%ct -- "${file}"`
        );

        if (!timestamp) {
            continue;
        }

        const lastModified = Number(timestamp) * 1000;
        const age = now - lastModified;

        if (age > SIX_MONTHS) {
            oldFiles.push({
                file,
                lastModified
            });
        }
    }

    return oldFiles;
}

/**
 * Main scan.
 */
function scanRepository() {
    console.log("");
    console.log("CodeRelic");
    console.log("────────────────────────────────────────");
    console.log("Scanning repository...");
    console.log("");

    const gitRoot = runGit("git rev-parse --show-toplevel");

    if (!gitRoot) {
        console.log("✕ This folder is not a Git repository.");
        console.log("");
        console.log("Run CodeRelic inside a Git repository.");
        process.exit(1);
    }

    const files = getTrackedFiles();

    if (files.length === 0) {
        console.log("No tracked files found.");
        process.exit(0);
    }

    console.log(`Files analyzed: ${files.length}`);

    // Find files with old Git activity.
    const oldFiles = findOldFiles(gitRoot, files);

    // Analyze imports.
    const importedBy = buildImportGraph(gitRoot, files);

    console.log("");
    console.log("Possible abandoned files:");
    console.log("");

    if (oldFiles.length === 0) {
        console.log("✓ No old files found.");
    } else {
        for (const oldFile of oldFiles) {
            const date = new Date(oldFile.lastModified)
                .toISOString()
                .split("T")[0];

            const importers = importedBy.get(oldFile.file) || [];

            console.log(`👻 ${oldFile.file}`);
            console.log(`   Last changed: ${date}`);
            console.log(`   Imported by: ${importers.length}`);

            if (importers.length === 0) {
                console.log("   Usage signal: none detected");
                console.log("   Evidence: HIGH");
            } else {
                console.log("   Usage signal: active");
                console.log("   Evidence: LOW");
            }

            if (importers.length > 0) {
                console.log("");
                console.log("   Imported from:");

                for (const importer of importers) {
                    console.log(`   - ${importer}`);
                }
            }

            console.log("");
        }
    }

    console.log("────────────────────────────────────────");

    const highConfidence = oldFiles.filter(oldFile => {
        const importers = importedBy.get(oldFile.file) || [];
        return importers.length === 0;
    });

    console.log(`Old files found: ${oldFiles.length}`);
    console.log(`High-confidence candidates: ${highConfidence.length}`);
    console.log("");
}

/**
 * CLI routing.
 */
if (!command || command === "--help" || command === "-h") {
    showHelp();
    process.exit(0);
}

if (command === "scan") {
    scanRepository();
} else {
    console.log(`✕ Unknown command: ${command}`);
    console.log("");
    showHelp();
    process.exit(1);
}