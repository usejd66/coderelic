const test = require("node:test");
const assert = require("node:assert");

const {
    calculateScore,
    getEvidenceLabel,
    isTestFile,
    extractImports
} = require("../index.js");

test("old unused file should have high evidence", () => {
    const score = calculateScore({
        oldFile: true,
        importers: 0,
        testReferences: 0
    });

    assert.strictEqual(score, 90);
    assert.strictEqual(getEvidenceLabel(score), "HIGH");
});

test("old imported file should have medium evidence", () => {
    const score = calculateScore({
        oldFile: true,
        importers: 1,
        testReferences: 0
    });

    assert.strictEqual(score, 50);
    assert.strictEqual(getEvidenceLabel(score), "MEDIUM");
});

test("old file imported by many files should have low evidence", () => {
    const score = calculateScore({
        oldFile: true,
        importers: 4,
        testReferences: 0
    });

    assert.strictEqual(score, 30);
    assert.strictEqual(getEvidenceLabel(score), "LOW");
});

test("test files should be detected", () => {
    assert.strictEqual(
        isTestFile("src/user.test.js"),
        true
    );

    assert.strictEqual(
        isTestFile("tests/auth.js"),
        true
    );

    assert.strictEqual(
        isTestFile("src/user.js"),
        false
    );
});

test("relative imports should be extracted", () => {
    const code = `
        import user from "./user";
        const auth = require("./auth");
    `;

    const imports = extractImports(code);

    assert.deepStrictEqual(
        imports,
        ["./user", "./auth"]
    );
});