/**
 * Evidence scoring for possible abandoned files.
 *
 * CodeRelic reports evidence, not certainty.
 */

/**
 * Build an auditable evidence breakdown for one file.
 */
function getEvidenceBreakdown({
    oldFile,
    importers,
    testReferences,
    runtimeSignal = false
}) {
    const breakdown = [];

    if (oldFile) {
        breakdown.push({
            points: 40,
            reason: "Old file"
        });
    }

    if (importers === 0) {
        breakdown.push({
            points: 30,
            reason: "No importers"
        });
    } else {
        breakdown.push({
            points: -Math.min(importers * 10, 30),
            reason: `Imported by ${importers} ${importers === 1 ? "file" : "files"}`
        });
    }

    if (testReferences === 0) {
        breakdown.push({
            points: 20,
            reason: "No test references"
        });
    } else {
        breakdown.push({
            points: -Math.min(testReferences * 5, 15),
            reason: `Referenced by ${testReferences} ${testReferences === 1 ? "test" : "tests"}`
        });
    }

    if (runtimeSignal) {
        breakdown.push({
            points: -30,
            reason: "Runtime/framework signal"
        });
    }

    return breakdown;
}

/**
 * Calculate evidence score for one file.
 */
function calculateScore({
    oldFile,
    importers,
    testReferences,
    runtimeSignal = false
}) {
    const rawScore = getEvidenceBreakdown({
        oldFile,
        importers,
        testReferences,
        runtimeSignal
    }).reduce(
        (total, item) => total + item.points,
        0
    );

    return Math.max(
        0,
        Math.min(100, rawScore)
    );
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

module.exports = {
    calculateScore,
    getEvidenceLabel,
    getEvidenceBreakdown
};
