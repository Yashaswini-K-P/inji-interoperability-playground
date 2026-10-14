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
let getPresentationRequestStatus;
let resultCalls;
let statusCalls;

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
    currentRun.verificationStatus = result.allChecksSuccessful
      ? "VERIFIED"
      : "REJECTED";
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
    currentRun.verificationStatus = "REJECTED";
    currentRun.verificationFailure = { code: errorCode };
    return currentRun;
  },
  setRunVerificationStatus: (runId, status) => {
    currentRun.verificationStatus = status;
    return currentRun;
  }
};

const verifierServiceMock = {
  createPresentationRequest: async () => ({}),
  getVerifierClientId: () => "did:web:verify.example",
  getPresentationRequestStatus: (...args) =>
    getPresentationRequestStatus(...args),
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
  statusCalls = [];
  currentRun = {
    runId: "RUN-RESULT-TEST",
    status: "IN_PROGRESS",
    verificationStatus: "PENDING",
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
  getPresentationRequestStatus = async (...args) => {
    statusCalls.push(args);
    return { status: "VP_SUBMITTED" };
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
  assert.deepEqual(statusCalls, [
    ["inji-verify", { requestId: "req-123" }]
  ]);
  assert.deepEqual(resultCalls, [
    ["inji-verify", { transactionId: "txn-123" }]
  ]);
  assert.equal(body.result, "PASS");
  assert.equal(body.verificationStatus, "VERIFIED");
  assert.equal(body.run.status, "COMPLETED");
  assert.equal(body.run.verificationStatus, "VERIFIED");
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
  assert.equal(body.verificationStatus, "REJECTED");
  assert.equal(body.run.status, "FAILED");
  assert.equal(body.run.verificationResult.allChecksSuccessful, false);
  assert.equal(body.exchange.resultStatus, "FAIL");
});

test("marks a verifier-confirmed invalid presentation as REJECTED", async () => {
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
  assert.equal(body.verificationStatus, "REJECTED");
  assert.equal(body.run.status, "FAILED");
  assert.equal(
    body.run.verificationFailure.code,
    "INVALID_VP_TOKEN"
  );
});

test("records a wallet-reported cancellation as rejected without inventing a verification result", async () => {
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

  assert.equal(response.status, 200);
  assert.equal(body.run.status, "FAILED");
  assert.equal(body.verificationStatus, "REJECTED");
  assert.equal(body.run.result, "FAIL");
  assert.equal(body.result, "FAIL");
  assert.equal(body.errorCode, "access_denied");
});

test("returns PENDING while Verify's request status is ACTIVE without querying results", async () => {
  resetRun();
  getPresentationRequestStatus = async () => ({ status: "ACTIVE" });

  const response = await retrieveResult();
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.equal(body.pending, true);
  assert.equal(body.verificationStatus, "PENDING");
  assert.equal(body.result, null);
  assert.equal(resultCalls.length, 0);
  assert.equal(body.exchange.diagnostic.code, "VERIFY_REQUEST_ACTIVE");
  assert.equal(currentRun.verificationStatus, "PENDING");
});

test("treats an expired Verify request as ERROR, not as a rejected credential", async () => {
  resetRun();
  getPresentationRequestStatus = async () => ({ status: "EXPIRED" });

  const response = await retrieveResult();
  const body = await response.json();

  assert.equal(response.status, 410);
  assert.equal(body.verificationStatus, "ERROR");
  assert.equal(body.errorCode, "VERIFY_REQUEST_EXPIRED");
  assert.equal(body.run.result, undefined);
  assert.equal(resultCalls.length, 0);
});

test("surfaces request-status API failures as ERROR with safe diagnostics", async () => {
  resetRun();
  getPresentationRequestStatus = async () => {
    throw Object.assign(new Error("private upstream response"), {
      response: {
        status: 503,
        data: {
          errorCode: "VERIFY_UNAVAILABLE",
          errorMessage: "contains sensitive upstream details"
        }
      }
    });
  };

  const response = await retrieveResult();
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.verificationStatus, "ERROR");
  assert.equal(body.diagnostic.code, "VERIFY_UNAVAILABLE");
  assert.equal(
    JSON.stringify(body).includes("sensitive upstream details"),
    false
  );
  assert.equal(resultCalls.length, 0);
});

test("keeps a confirmed submission pending if the result API briefly has no stored submission", async () => {
  resetRun();
  let attempts = 0;
  getPresentationResult = async () => {
    attempts += 1;
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
  assert.equal(attempts, 3);
  assert.equal(body.pending, true);
  assert.equal(body.verificationStatus, "SUBMITTED");
  assert.equal(body.result, null);
  assert.equal(body.run.status, "IN_PROGRESS");
  assert.equal(body.run.verificationStatus, "SUBMITTED");
  assert.equal(body.exchange.status, "PENDING");
});

test("records transport errors without claiming verification is pending or successful", async () => {
  resetRun();
  getPresentationResult = async () => {
    throw Object.assign(new Error("socket details"), {
      code: "ECONNABORTED"
    });
  };

  const response = await retrieveResult();
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.pending, false);
  assert.equal(body.verificationStatus, "ERROR");
  assert.equal(body.run.verificationStatus, "ERROR");
  assert.equal(body.run.status, "IN_PROGRESS");
  assert.equal(body.exchange.status, "ERROR");
  assert.equal(body.exchange.diagnostic.code, "ECONNABORTED");
  assert.equal(body.exchange.error, "Verification result is unavailable");
  assert.equal(JSON.stringify(body).includes("socket details"), false);
});

test("records malformed Verify responses as ERROR without inferring a result", async () => {
  resetRun();
  getPresentationResult = async () => ({
    transactionId: "another-transaction",
    allChecksSuccessful: true,
    credentialResults: []
  });

  const response = await retrieveResult();
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.pending, false);
  assert.equal(body.verificationStatus, "ERROR");
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
  assert.equal(body.pending, false);
  assert.equal(body.verificationStatus, "ERROR");
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
    assert.equal(body.pending, false);
    assert.equal(body.verificationStatus, "ERROR");
    assert.equal(body.run.status, "IN_PROGRESS");
    assert.equal(body.run.result, undefined);
    assert.equal(
      body.exchange.diagnostic.code,
      "INVALID_VERIFIER_RESULT"
    );
  }
});
