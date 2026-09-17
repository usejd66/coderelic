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

const TEST_PATTERNS = [
    ".test.",
    ".spec.",
    "__tests__/",
    "tests/",
    "test/"
];

const SIX_MONTHS = 180 * 24 * 60 * 60 * 1000;

/**
 * Run a Git command safely.
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
 * Display CLI help.
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
 * Check whether a path is a source file.
 */
function isSourceFile(file) {
    return SOURCE_EXTENSIONS.some(extension =>
        file.endsWith(extension)
    );
}

/**
 * Check whether a file looks like a test file.
 */
function isTestFile(file) {
    return TEST_PATTERNS.some(pattern =>
        file.includes(pattern)
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
 * Get tracked files.
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
 * Extract relative imports and requires.
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

    const candidates = [
        basePath,
        ...SOURCE_EXTENSIONS.map(ext => basePath + ext),
        ...SOURCE_EXTENSIONS.map(ext =>
            path.join(basePath, `index${ext}`)
        )
    ];

    for (const candidate of candidates) {
        const normalized = candidate.replace(/\\/g, "/");

        if (trackedFilesSet.has(normalized)) {
            return normalized;
        }
    }

    return null;
}

/**
 * Build import graph.
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

            const importers = importedBy.get(target);

            if (importers && !importers.includes(importer)) {
                importers.push(importer);
            }
        }
    }

    return importedBy;
}

/**
 * Find old files using Git history.
 */
function findOldFiles(files) {
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
 * Find test files that reference a target file.
 */
function findTestReferences(gitRoot, files, targetFile) {
    const references = [];

    const targetName = path.basename(targetFile, path.extname(targetFile));

    for (const file of files) {
        if (!isTestFile(file)) {
            continue;
        }

        const absolutePath = path.join(gitRoot, file);
        const content = readFile(absolutePath);

        if (!content) {
            continue;
        }

        const normalizedTarget = targetFile.replace(/\\/g, "/");

        const possibleNames = [
            targetName,
            normalizedTarget,
            `./${normalizedTarget}`
        ];

        const matches = possibleNames.some(name =>
            content.includes(name)
        );

        if (matches) {
            references.push(file);
        }
    }

    return references;
}

/**
 * Calculate evidence score.
 */
function calculateScore({
    oldFile,
    importers,
    testReferences
}) {
    let score = 0;

    // Old file is the starting point.
    if (oldFile) {
        score += 40;
    }

    // No imports increases abandonment evidence.
    if (importers === 0) {
        score += 30;
    } else {
        score -= Math.min(importers * 10, 30);
    }

    // No test references increases evidence.
    if (testReferences === 0) {
        score += 20;
    } else {
        score -= Math.min(testReferences * 5, 15);
    }

    return Math.max(0, Math.min(100, score));
}

/**
 * Convert score to a label.
 */
function getEvidenceLabel(score) {
    if (score >= 70) {
        return "HIGH";
    }

    if (score >= 40) {
        return "MEDIUM";
    }

    return "LOW";
}

/**
 * Scan repository.
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
        process.exit(1);
    }

    const files = getTrackedFiles();

    if (files.length === 0) {
        console.log("No tracked files found.");
        process.exit(0);
    }

    console.log(`Files analyzed: ${files.length}`);

    const oldFiles = findOldFiles(files);
    const importedBy = buildImportGraph(gitRoot, files);

    console.log("");
    console.log("Possible abandoned files:");
    console.log("");

    if (oldFiles.length === 0) {
        console.log("✓ No old files found.");
        console.log("");
    }

    let highConfidence = 0;
    let mediumConfidence = 0;

    for (const oldFile of oldFiles) {
        const importers = importedBy.get(oldFile.file) || [];

        const testReferences = findTestReferences(
            gitRoot,
            files,
            oldFile.file
        );

        const score = calculateScore({
            oldFile: true,
            importers: importers.length,
            testReferences: testReferences.length
        });

        const evidence = getEvidenceLabel(score);

        if (evidence === "HIGH") {
            highConfidence++;
        } else if (evidence === "MEDIUM") {
            mediumConfidence++;
        }

        const date = new Date(oldFile.lastModified)
            .toISOString()
            .split("T")[0];

        console.log(`👻 ${oldFile.file}`);
        console.log(`   Last changed: ${date}`);
        console.log(`   Imported by: ${importers.length}`);
        console.log(`   Test references: ${testReferences.length}`);
        console.log(`   Evidence score: ${score}/100`);
        console.log(`   Evidence: ${evidence}`);

        if (importers.length > 0) {
            console.log("");
            console.log("   Imported from:");

            for (const importer of importers) {
                console.log(`   - ${importer}`);
            }
        }

        if (testReferences.length > 0) {
            console.log("");
            console.log("   Test references:");

            for (const test of testReferences) {
                console.log(`   - ${test}`);
            }
        }

        console.log("");
    }

    console.log("────────────────────────────────────────");
    console.log(`Old files found: ${oldFiles.length}`);
    console.log(`High-confidence candidates: ${highConfidence}`);
    console.log(`Medium-confidence candidates: ${mediumConfidence}`);
    console.log("");
}

/**
 * CLI routing.
 */
/**
 * CLI routing.
 */
if (require.main === module) {
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
}

module.exports = {
    calculateScore,
    getEvidenceLabel,
    isTestFile,
    extractImports
};