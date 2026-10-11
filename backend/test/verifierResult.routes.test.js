const assert = require("node:assert/strict");
const express = require("express");
const Module = require("node:module");
const test = require("node:test");

const runServicePath = require.resolve(
  "../src/services/run.service"
);
const verifierServicePath = require.resolve(
  "../src/services/verifier.service"
);
const routePath = require.resolve(
  "../src/routes/verifier.routes"
);

let currentRun;
let exchanges;
let server;
let baseUrl;
let getPresentationResult;
let resultCalls;

const runServiceMock = {
  getRun: () => currentRun,
  addExchange: (runId, exchange) => {
    const recordedExchange = {
      step: exchanges.length + 1,
      timestamp: new Date().toISOString(),
      ...exchange
    };
    exchanges.push(recordedExchange);
    if (recordedExchange.status === "FAILED") {
      currentRun.status = "FAILED";
    }
    return recordedExchange;
  },
  setRunPresentationRequest: () => {},
  setRunVerificationResult: (runId, result) => {
    currentRun.verificationResult = {
      ...result,
      retrievedAt: new Date().toISOString()
    };
    currentRun.status = result.allChecksSuccessful
      ? "COMPLETED"
      : "FAILED";
    currentRun.result = result.allChecksSuccessful
      ? "PASS"
      : "FAIL";
    return currentRun;
  },
  setRunVerificationFailure: (runId, errorCode) => {
    currentRun.status = "FAILED";
    currentRun.result = "FAIL";
    currentRun.verificationFailure = { code: errorCode };
    return currentRun;
  }
};

const verifierServiceMock = {
  createPresentationRequest: async () => ({}),
  getVerifierClientId: () => "did:web:verify.example",
  getPresentationResult: (...args) =>
    getPresentationResult(...args)
};

function mockModule(modulePath, exports) {
  const mockedModule = new Module(modulePath);
  mockedModule.filename = modulePath;
  mockedModule.loaded = true;
  mockedModule.exports = exports;
  require.cache[modulePath] = mockedModule;
}

test.before(async () => {
  const originalRunModule = require.cache[runServicePath];
  const originalVerifierModule =
    require.cache[verifierServicePath];

  mockModule(runServicePath, runServiceMock);
  mockModule(verifierServicePath, verifierServiceMock);
  delete require.cache[routePath];
  const verifierRoutes = require(routePath);

  if (originalRunModule) {
    require.cache[runServicePath] = originalRunModule;
  } else {
    delete require.cache[runServicePath];
  }

  if (originalVerifierModule) {
    require.cache[verifierServicePath] = originalVerifierModule;
  } else {
    delete require.cache[verifierServicePath];
  }

  const app = express();
  app.use(express.json());
  app.use("/api/verify", verifierRoutes);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
});

function resetRun() {
  exchanges = [];
  resultCalls = [];
  currentRun = {
    runId: "RUN-RESULT-TEST",
    status: "IN_PROGRESS",
    token: {
      access_token: "sensitive-access-token"
    },
    scenario: {
      verifier: "inji-verify",
      presentationProtocol: "openid4vp"
    },
    presentationRequest: {
      verifierId: "inji-verify",
      requestId: "req-123",
      transactionId: "txn-123",
      authorizationRequest: {
        requestId: "req-123",
        transactionId: "txn-123"
      }
    }
  };
  getPresentationResult = async (...args) => {
    resultCalls.push(args);
    return {
      transactionId: "txn-123",
      allChecksSuccessful: true,
      credentialResults: [
        {
          verifiableCredential: "sensitive-credential-content",
          allChecksSuccessful: true
        }
      ]
    };
  };
}

async function retrieveResult() {
  return fetch(
    `${baseUrl}/api/verify/runs/RUN-RESULT-TEST/result`
  );
}

test("marks a run COMPLETED/PASS only for Verify's successful result", async () => {
  resetRun();

  const response = await retrieveResult();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(resultCalls, [
    ["inji-verify", { transactionId: "txn-123" }]
  ]);
  assert.equal(body.result, "PASS");
  assert.equal(body.run.status, "COMPLETED");
  assert.equal(
    body.run.verificationResult.allChecksSuccessful,
    true
  );
  assert.equal(body.run.verificationResult.credentialCount, 1);
  assert.equal(body.exchange.resultStatus, "PASS");
  assert.equal(
    JSON.stringify(body).includes("sensitive-credential-content"),
    false
  );
  assert.equal(
    JSON.stringify(body).includes("sensitive-access-token"),
    false
  );
  assert.equal(Object.hasOwn(body.run, "token"), false);
});

test("marks an authoritative negative verification result FAILED", async () => {
  resetRun();
  getPresentationResult = async () => ({
    transactionId: "txn-123",
    allChecksSuccessful: false,
    credentialResults: [{ allChecksSuccessful: false }]
  });

  const response = await retrieveResult();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.result, "FAIL");
  assert.equal(body.run.status, "FAILED");
  assert.equal(body.run.verificationResult.allChecksSuccessful, false);
  assert.equal(body.exchange.resultStatus, "FAIL");
});

test("marks a verifier-confirmed invalid presentation as a terminal FAIL", async () => {
  resetRun();
  getPresentationResult = async () => {
    throw Object.assign(new Error("invalid presentation"), {
      response: {
        status: 400,
        data: {
          errorCode: "INVALID_VP_TOKEN",
          errorMessage: "Invalid presentation"
        }
      }
    });
  };

  const response = await retrieveResult();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.result, "FAIL");
  assert.equal(body.run.status, "FAILED");
  assert.equal(
    body.run.verificationFailure.code,
    "INVALID_VP_TOKEN"
  );
});

test("records a wallet-reported cancellation as failed without inventing a verification result", async () => {
  resetRun();
  getPresentationResult = async () => {
    throw Object.assign(new Error("wallet error"), {
      response: {
        status: 404,
        data: {
          errorCode: "access_denied",
          errorMessage: "User declined"
        }
      }
    });
  };

  const response = await retrieveResult();
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.run.status, "FAILED");
  assert.equal(body.run.result, undefined);
  assert.equal(body.result, null);
  assert.equal(body.errorCode, "access_denied");
});

test("keeps runs pending when Verify reports that no wallet submission exists", async () => {
  resetRun();
  getPresentationResult = async () => {
    throw Object.assign(new Error("No VP submission"), {
      response: {
        status: 404,
        data: {
          errorCode: "NO_VP_SUBMISSION",
          errorMessage: "No VP submission found"
        }
      }
    });
  };

  const response = await retrieveResult();
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.equal(body.pending, true);
  assert.equal(body.result, null);
  assert.equal(body.run.status, "IN_PROGRESS");
  assert.equal(body.exchange.status, "PENDING");
});

test("keeps the result pending after transport errors and records a safe diagnostic", async () => {
  resetRun();
  getPresentationResult = async () => {
    throw Object.assign(new Error("socket details"), {
      code: "ECONNABORTED"
    });
  };

  const response = await retrieveResult();
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.pending, true);
  assert.equal(body.run.status, "IN_PROGRESS");
  assert.equal(body.exchange.status, "ERROR");
  assert.equal(body.exchange.diagnostic.code, "ECONNABORTED");
  assert.equal(body.exchange.error, "Verification result is unavailable");
  assert.equal(JSON.stringify(body).includes("socket details"), false);
});

test("does not infer a result from a mismatched or malformed Verify response", async () => {
  resetRun();
  getPresentationResult = async () => ({
    transactionId: "another-transaction",
    allChecksSuccessful: true,
    credentialResults: []
  });

  const response = await retrieveResult();
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.pending, true);
  assert.equal(body.run.status, "IN_PROGRESS");
  assert.equal(body.exchange.diagnostic.code, "INVALID_VERIFIER_RESULT");
});

test("does not report PASS when Verify returns no credential results", async () => {
  resetRun();
  getPresentationResult = async () => ({
    transactionId: "txn-123",
    allChecksSuccessful: true,
    credentialResults: []
  });

  const response = await retrieveResult();
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.pending, true);
  assert.equal(body.run.status, "IN_PROGRESS");
  assert.equal(body.run.result, undefined);
  assert.equal(body.exchange.diagnostic.code, "INVALID_VERIFIER_RESULT");
});

test("does not report PASS for malformed or internally inconsistent credential results", async () => {
  for (const result of [
    {
      transactionId: "txn-123",
      allChecksSuccessful: true,
      credentialResults: [{}]
    },
    {
      transactionId: "txn-123",
      allChecksSuccessful: true,
      credentialResults: [
        { allChecksSuccessful: false }
      ]
    }
  ]) {
    resetRun();
    getPresentationResult = async () => result;

    const response = await retrieveResult();
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.equal(body.pending, true);
    assert.equal(body.run.status, "IN_PROGRESS");
    assert.equal(body.run.result, undefined);
    assert.equal(
      body.exchange.diagnostic.code,
      "INVALID_VERIFIER_RESULT"
    );
  }
});
