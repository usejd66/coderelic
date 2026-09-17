#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const {
    calculateScore,
    getEvidenceLabel,
    getEvidenceBreakdown
} = require("./src/scoring/evidence");

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

function daysToMilliseconds(days) {
    return days * 24 * 60 * 60 * 1000;
}

function getDaysArgument(args) {
    const daysIndex = args.indexOf("--days");

    if (daysIndex === -1) {
        return 180;
    }

    const value = args[daysIndex + 1];

    if (value === undefined) {
        throw new Error(
            "--days requires a whole number between 1 and 365."
        );
    }

    const days = Number(value);

    if (
        !Number.isInteger(days) ||
        days < 1 ||
        days > 365
    ) {
        throw new Error(
            "--days requires a whole number between 1 and 365."
        );
    }

    return days;
}

function isFileOlderThan(
    lastModified,
    threshold,
    now = Date.now()
) {
    return now - lastModified > threshold;
}


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
  coderelic scan --days <1-365>
  coderelic --help

Options:
  --days <1-365>    Set the age threshold in days.
                    Default: 180 days.
`);
}


/**
 * Check whether a file is a source file.
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
 * Detect files that may be managed automatically
 * by a framework or runtime.
 *
 * This is only a signal, not proof that the file is active.
 */
function isPotentialRuntimeEntry(file) {
    const normalized = file
        .replace(/\\/g, "/")
        .toLowerCase();

    const fileName = path.basename(normalized);

    const runtimeNamePatterns = [
        /^index\./,
        /controller\./,
        /route\./,
        /router\./,
        /middleware\./,
        /handler\./,
        /plugin\./,
        /^page\./,
        /^layout\./
    ];

    const runtimeDirectories = [
        "/routes/",
        "/pages/",
        "/api/",
        "/controllers/",
        "/handlers/",
        "/middleware/",
        "/plugins/"
    ];

    const hasRuntimeName = runtimeNamePatterns.some(pattern =>
        pattern.test(fileName)
    );

    // Add "/" around the path so root folders like
    // "routes/users.js" also match "/routes/".
    const pathForMatching = `/${normalized}`;

    const hasRuntimeDirectory = runtimeDirectories.some(directory =>
        pathForMatching.includes(directory)
    );

    return hasRuntimeName || hasRuntimeDirectory;
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
        /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
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
function resolveImport(
    importer,
    importPath,
    trackedFilesSet
) {
    if (!importPath.startsWith(".")) {
        return null;
    }

    const importerDirectory = path.dirname(importer);

    const basePath = path.normalize(
        path.join(importerDirectory, importPath)
    );

    const candidates = [
        basePath,

        ...SOURCE_EXTENSIONS.map(extension =>
            basePath + extension
        ),

        ...SOURCE_EXTENSIONS.map(extension =>
            path.join(basePath, `index${extension}`)
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

        const absolutePath = path.join(
            gitRoot,
            importer
        );

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

            if (
                importers &&
                !importers.includes(importer)
            ) {
                importers.push(importer);
            }
        }
    }

    return importedBy;
}


/**
 * Find old files using Git history.
 */
function findOldFiles(
    files,
    threshold = SIX_MONTHS
) {
    const now = Date.now();
    const oldFiles = [];

    for (const file of files) {
        const timestamp = runGit(
            `git log -1 --format=%ct -- "${file}"`
        );

        if (!timestamp) {
            continue;
        }

        const lastModified =
            Number(timestamp) * 1000;

        if (
            isFileOlderThan(
                lastModified,
                threshold,
                now
            )
        ) {
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
function findTestReferences(
    gitRoot,
    files,
    targetFile
) {
    const references = [];

    const targetName = path.basename(
        targetFile,
        path.extname(targetFile)
    );

    for (const file of files) {
        if (!isTestFile(file)) {
            continue;
        }

        const absolutePath = path.join(
            gitRoot,
            file
        );

        const content = readFile(absolutePath);

        if (!content) {
            continue;
        }

        const normalizedTarget =
            targetFile.replace(/\\/g, "/");

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
 * Get the feature/area name from a file path.
 */
function getFeatureArea(file) {
    const normalized =
        file.replace(/\\/g, "/");

    const parts = normalized.split("/");

    if (parts.length === 1) {
        return "(root)";
    }

    return parts[0];
}


/**
 * Aggregate file evidence into feature/area evidence.
 */
function aggregateFeatureAreas(
    files,
    oldFiles,
    importedBy,
    testReferencesBy
) {
    const oldFileSet = new Set(
        oldFiles.map(item => item.file)
    );

    const areas = new Map();

    for (const file of files) {
        const areaName =
            getFeatureArea(file);

        if (!areas.has(areaName)) {
            areas.set(areaName, {
                area: areaName,
                totalFiles: 0,
                oldFiles: 0,
                activeImporters: 0,
                testReferences: 0
            });
        }

        const area = areas.get(areaName);

        area.totalFiles++;

        if (oldFileSet.has(file)) {
            area.oldFiles++;
        }

        const importers =
            importedBy.get(file) || [];

        area.activeImporters +=
            importers.length;

        const testReferences =
            testReferencesBy.get(file) || [];

        area.testReferences +=
            testReferences.length;
    }

    const results = [];

    for (const area of areas.values()) {
        const oldRatio =
            area.totalFiles === 0
                ? 0
                : area.oldFiles /
                  area.totalFiles;

        let score =
            Math.round(oldRatio * 50);

        if (area.activeImporters === 0) {
            score += 30;
        }

        if (area.testReferences === 0) {
            score += 20;
        }

        score = Math.max(
            0,
            Math.min(100, score)
        );

        results.push({
            ...area,
            score,
            evidence: getEvidenceLabel(score)
        });
    }

    return results.sort(
        (a, b) => b.score - a.score
    );
}


/**
 * Scan repository.
 */
function scanRepository(
    threshold = SIX_MONTHS
) {
    console.log("");
    console.log("CodeRelic");
    console.log(
        "────────────────────────────────────────"
    );
    console.log("Scanning repository...");

    const days =
        threshold /
        (24 * 60 * 60 * 1000);

    console.log(
        `Age threshold: ${days} days`
    );

    console.log("");

    const gitRoot = runGit(
        "git rev-parse --show-toplevel"
    );

    if (!gitRoot) {
        console.log(
            "This folder is not a Git repository."
        );

        process.exit(1);
    }

    const files = getTrackedFiles();

    if (files.length === 0) {
        console.log(
            "No tracked files found."
        );

        process.exit(0);
    }

    console.log(
        `Files analyzed: ${files.length}`
    );

    const oldFiles =
        findOldFiles(files, threshold);

    const importedBy =
        buildImportGraph(
            gitRoot,
            files
        );

    const testReferencesBy = new Map();

    for (const oldFile of oldFiles) {
        const references =
            findTestReferences(
                gitRoot,
                files,
                oldFile.file
            );

        testReferencesBy.set(
            oldFile.file,
            references
        );
    }

    console.log("");
    console.log(
        "Possible abandoned files:"
    );
    console.log("");

    let highConfidence = 0;
    let mediumConfidence = 0;

    for (const oldFile of oldFiles) {
        const importers =
            importedBy.get(
                oldFile.file
            ) || [];

        const testReferences =
            testReferencesBy.get(
                oldFile.file
            ) || [];

        const runtimeSignal =
            isPotentialRuntimeEntry(
                oldFile.file
            );

        const score = calculateScore({
            oldFile: true,
            importers: importers.length,
            testReferences: testReferences.length,
            runtimeSignal
        });

        const evidence =
            getEvidenceLabel(score);

        if (evidence === "HIGH") {
            highConfidence++;
        }

        if (evidence === "MEDIUM") {
            mediumConfidence++;
        }

        const date =
            new Date(
                oldFile.lastModified
            )
                .toISOString()
                .split("T")[0];

        console.log(
            `👻 ${oldFile.file}`
        );

        console.log(
            `   Last changed: ${date}`
        );

        console.log(
            `   Imported by: ${importers.length}`
        );

        console.log(
            `   Test references: ${testReferences.length}`
        );

        console.log("");
        console.log("   Evidence breakdown:");

        const breakdown =
            getEvidenceBreakdown({
                oldFile: true,
                importers: importers.length,
                testReferences: testReferences.length,
                runtimeSignal
            });

        for (const item of breakdown) {
            const sign = item.points >= 0 ? "+" : "";
            console.log(
                `   ${sign}${item.points}  ${item.reason}`
            );
        }

        console.log("");
        console.log(
            `   Evidence score: ${score}/100`
        );

        console.log(
            `   Evidence: ${evidence}`
        );

        if (runtimeSignal) {
            console.log(
                "   Runtime signal: possible framework-managed file"
            );
        }

        if (importers.length > 0) {
            console.log("");
            console.log(
                "   Imported from:"
            );

            for (const importer of importers) {
                console.log(
                    `   - ${importer}`
                );
            }
        }

        if (testReferences.length > 0) {
            console.log("");
            console.log(
                "   Test references:"
            );

            for (const test of testReferences) {
                console.log(
                    `   - ${test}`
                );
            }
        }

        console.log("");
    }

    const areas =
        aggregateFeatureAreas(
            files,
            oldFiles,
            importedBy,
            testReferencesBy
        );

    const featureAreas =
        areas.filter(
            area => area.area !== "(root)"
        );

    if (featureAreas.length > 0) {
        console.log(
            "Feature / area analysis:"
        );

        console.log("");

        for (const area of featureAreas) {
            console.log(
                `>> ${area.area}/`
            );

            console.log(
                `   Files: ${area.totalFiles}`
            );

            console.log(
                `   Old files: ${area.oldFiles}`
            );

            console.log(
                `   Active imports: ${area.activeImporters}`
            );

            console.log(
                `   Test references: ${area.testReferences}`
            );

            console.log(
                `   Evidence score: ${area.score}/100`
            );

            console.log(
                `   Evidence: ${area.evidence}`
            );

            console.log("");
        }
    }

    console.log(
        "────────────────────────────────────────"
    );

    console.log(
        `Old files found: ${oldFiles.length}`
    );

    console.log(
        `High-confidence candidates: ${highConfidence}`
    );

    console.log(
        `Medium-confidence candidates: ${mediumConfidence}`
    );

    console.log(
        `Feature areas analyzed: ${featureAreas.length}`
    );

    console.log("");
}


/**
 * CLI routing.
 */
if (require.main === module) {
    if (
        !command ||
        command === "--help" ||
        command === "-h"
    ) {
        showHelp();
        process.exit(0);
    }

    if (command === "scan") {
        try {
            const days =
                getDaysArgument(
                    process.argv.slice(2)
                );

            const threshold =
                daysToMilliseconds(days);

            scanRepository(threshold);
        } catch (error) {
            console.error(
                `Error: ${error.message}`
            );

            process.exit(1);
        }
    } else {
        console.log(
            `Unknown command: ${command}`
        );

        console.log("");

        showHelp();

        process.exit(1);
    }
}


module.exports = {
    calculateScore,
    getEvidenceLabel,
    getEvidenceBreakdown,
    isTestFile,
    extractImports,
    getFeatureArea,
    aggregateFeatureAreas,
    isPotentialRuntimeEntry,
    isFileOlderThan,
    daysToMilliseconds,
    getDaysArgument
};