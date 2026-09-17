const test = require("node:test");
const assert = require("node:assert");

const {
    calculateScore,
    getEvidenceLabel,
    getEvidenceBreakdown
} = require("../../src/scoring/evidence");

test("evidence breakdown explains an old unused file", () => {
    const breakdown = getEvidenceBreakdown({
        oldFile: true,
        importers: 0,
        testReferences: 0
    });

    assert.deepStrictEqual(breakdown, [
        {
            points: 40,
            reason: "Old file"
        },
        {
            points: 30,
            reason: "No importers"
        },
        {
            points: 20,
            reason: "No test references"
        }
    ]);

    assert.strictEqual(
        calculateScore({
            oldFile: true,
            importers: 0,
            testReferences: 0
        }),
        90
    );
});

test("evidence breakdown explains importers, tests, and runtime signal", () => {
    const breakdown = getEvidenceBreakdown({
        oldFile: true,
        importers: 2,
        testReferences: 2,
        runtimeSignal: true
    });

    assert.deepStrictEqual(breakdown, [
        {
            points: 40,
            reason: "Old file"
        },
        {
            points: -20,
            reason: "Imported by 2 files"
        },
        {
            points: -10,
            reason: "Referenced by 2 tests"
        },
        {
            points: -30,
            reason: "Runtime/framework signal"
        }
    ]);

    assert.strictEqual(
        calculateScore({
            oldFile: true,
            importers: 2,
            testReferences: 2,
            runtimeSignal: true
        }),
        0
    );
});

test("evidence penalties are capped", () => {
    const breakdown = getEvidenceBreakdown({
        oldFile: true,
        importers: 10,
        testReferences: 10,
        runtimeSignal: false
    });

    assert.deepStrictEqual(breakdown, [
        {
            points: 40,
            reason: "Old file"
        },
        {
            points: -30,
            reason: "Imported by 10 files"
        },
        {
            points: -15,
            reason: "Referenced by 10 tests"
        }
    ]);

    assert.strictEqual(
        calculateScore({
            oldFile: true,
            importers: 10,
            testReferences: 10
        }),
        0
    );
});

test("evidence labels remain unchanged", () => {
    assert.strictEqual(getEvidenceLabel(100), "HIGH");
    assert.strictEqual(getEvidenceLabel(70), "HIGH");
    assert.strictEqual(getEvidenceLabel(69), "MEDIUM");
    assert.strictEqual(getEvidenceLabel(40), "MEDIUM");
    assert.strictEqual(getEvidenceLabel(39), "LOW");
    assert.strictEqual(getEvidenceLabel(0), "LOW");
});
