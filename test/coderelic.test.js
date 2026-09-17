const test = require("node:test");
const assert = require("node:assert");

const {
    calculateScore,
    getEvidenceLabel,
    isTestFile,
    extractImports,
    getFeatureArea,
    aggregateFeatureAreas,
    isPotentialRuntimeEntry,
    isFileOlderThan,
    daysToMilliseconds,
    getDaysArgument
} = require("../index");


// --------------------------------------------------
// Evidence scoring tests
// --------------------------------------------------

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


// --------------------------------------------------
// Test file detection
// --------------------------------------------------

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


// --------------------------------------------------
// Import detection
// --------------------------------------------------

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


test("dynamic imports should be extracted", () => {
    const code = `
        const payments = import("./payments");
    `;

    const imports = extractImports(code);

    assert.deepStrictEqual(
        imports,
        ["./payments"]
    );
});


// --------------------------------------------------
// File age tests
// --------------------------------------------------

test("custom age threshold should identify old files", () => {
    const now = Date.now();
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;

    assert.strictEqual(
        isFileOlderThan(
            now - ninetyDays - 1000,
            ninetyDays,
            now
        ),
        true
    );

    assert.strictEqual(
        isFileOlderThan(
            now - ninetyDays + 1000,
            ninetyDays,
            now
        ),
        false
    );
});


test("days should be converted to milliseconds", () => {
    assert.strictEqual(
        daysToMilliseconds(1),
        24 * 60 * 60 * 1000
    );

    assert.strictEqual(
        daysToMilliseconds(90),
        90 * 24 * 60 * 60 * 1000
    );
});


test("days argument should be parsed correctly", () => {
    assert.strictEqual(
        getDaysArgument(["scan", "--days", "1"]),
        1
    );

    assert.strictEqual(
        getDaysArgument(["scan", "--days", "90"]),
        90
    );

    assert.strictEqual(
        getDaysArgument(["scan", "--days", "180"]),
        180
    );

    assert.strictEqual(
        getDaysArgument(["scan", "--days", "365"]),
        365
    );

    assert.strictEqual(
        getDaysArgument(["scan"]),
        180
    );

    assert.throws(
        () => getDaysArgument(
            ["scan", "--days", "0"]
        ),
        /--days requires a whole number between 1 and 365/
    );

    assert.throws(
        () => getDaysArgument(
            ["scan", "--days", "366"]
        ),
        /--days requires a whole number between 1 and 365/
    );

    assert.throws(
        () => getDaysArgument(
            ["scan", "--days", "-30"]
        ),
        /--days requires a whole number between 1 and 365/
    );

    assert.throws(
        () => getDaysArgument(
            ["scan", "--days", "90.5"]
        ),
        /--days requires a whole number between 1 and 365/
    );

    assert.throws(
        () => getDaysArgument(
            ["scan", "--days", "abc"]
        ),
        /--days requires a whole number between 1 and 365/
    );

    assert.throws(
        () => getDaysArgument(
            ["scan", "--days"]
        ),
        /--days requires a whole number between 1 and 365/
    );
});


// --------------------------------------------------
// Feature area detection
// --------------------------------------------------

test("feature area should be detected from file path", () => {
    assert.strictEqual(
        getFeatureArea("payments/PaymentService.js"),
        "payments"
    );

    assert.strictEqual(
        getFeatureArea("auth/UserService.js"),
        "auth"
    );

    assert.strictEqual(
        getFeatureArea("app.js"),
        "(root)"
    );
});


test("feature areas should aggregate evidence", () => {
    const files = [
        "payments/PaymentService.js",
        "payments/PaymentController.js",
        "payments/PaymentTest.test.js",
        "users/UserService.js",
        "users/UserController.js"
    ];

    const oldFiles = [
        {
            file: "payments/PaymentService.js"
        },
        {
            file: "payments/PaymentController.js"
        },
        {
            file: "users/UserService.js"
        }
    ];

    const importedBy = new Map([
        [
            "payments/PaymentService.js",
            []
        ],
        [
            "payments/PaymentController.js",
            []
        ],
        [
            "payments/PaymentTest.test.js",
            []
        ],
        [
            "users/UserService.js",
            []
        ],
        [
            "users/UserController.js",
            [
                "some-other-file.js"
            ]
        ]
    ]);

    const testReferencesBy = new Map([
        [
            "payments/PaymentService.js",
            [
                "payments/PaymentTest.test.js"
            ]
        ],
        [
            "payments/PaymentController.js",
            []
        ],
        [
            "users/UserService.js",
            []
        ]
    ]);

    const areas = aggregateFeatureAreas(
        files,
        oldFiles,
        importedBy,
        testReferencesBy
    );

    const payments = areas.find(
        area => area.area === "payments"
    );

    const users = areas.find(
        area => area.area === "users"
    );

    assert.ok(payments);
    assert.ok(users);

    assert.strictEqual(
        payments.totalFiles,
        3
    );

    assert.strictEqual(
        payments.oldFiles,
        2
    );

    assert.strictEqual(
        payments.testReferences,
        1
    );

    assert.strictEqual(
        users.totalFiles,
        2
    );

    assert.strictEqual(
        users.oldFiles,
        1
    );

    assert.strictEqual(
        users.activeImporters,
        1
    );
});


// --------------------------------------------------
// Runtime/framework detection
// --------------------------------------------------

test("framework-like files should be treated as runtime signals", () => {
    assert.strictEqual(
        isPotentialRuntimeEntry(
            "payments/PaymentController.js"
        ),
        true
    );

    assert.strictEqual(
        isPotentialRuntimeEntry(
            "routes/users.js"
        ),
        true
    );

    assert.strictEqual(
        isPotentialRuntimeEntry(
            "pages/index.js"
        ),
        true
    );

    assert.strictEqual(
        isPotentialRuntimeEntry(
            "utils/math.js"
        ),
        false
    );
});


test("runtime signal should reduce abandonment evidence", () => {
    const score = calculateScore({
        oldFile: true,
        importers: 0,
        testReferences: 0,
        runtimeSignal: true
    });

    assert.strictEqual(score, 60);

    assert.strictEqual(
        getEvidenceLabel(score),
        "MEDIUM"
    );
});