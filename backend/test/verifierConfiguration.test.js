const assert = require("node:assert/strict");
const express = require("express");
const test = require("node:test");

const componentsPath = require.resolve(
  "../src/config/components"
);
const componentRoutePath = require.resolve(
  "../src/routes/component.routes"
);
const registryPath = require.resolve(
  "../src/services/componentRegistry.service"
);
const verifierServicePath = require.resolve(
  "../src/services/verifier.service"
);
const configKeys = [
  componentRoutePath,
  componentsPath,
  registryPath,
  verifierServicePath
];
const originalClientId = process.env.INJI_VERIFY_CLIENT_ID;
const originalVerifyUrl = process.env.INJI_VERIFY_URL;
const originalUnrelatedSecret =
  process.env.PLAYGROUND_TEST_UNRELATED_SECRET;

function loadVerifierServiceWithCurrentEnvironment() {
  for (const key of configKeys) {
    delete require.cache[key];
  }

  return require("../src/services/verifier.service");
}

test.after(() => {
  if (originalClientId === undefined) {
    delete process.env.INJI_VERIFY_CLIENT_ID;
  } else {
    process.env.INJI_VERIFY_CLIENT_ID = originalClientId;
  }

  if (originalVerifyUrl === undefined) {
    delete process.env.INJI_VERIFY_URL;
  } else {
    process.env.INJI_VERIFY_URL = originalVerifyUrl;
  }

  if (originalUnrelatedSecret === undefined) {
    delete process.env.PLAYGROUND_TEST_UNRELATED_SECRET;
  } else {
    process.env.PLAYGROUND_TEST_UNRELATED_SECRET =
      originalUnrelatedSecret;
  }

  for (const key of configKeys) {
    delete require.cache[key];
  }
});

test("includes the configured verifier client ID in the components API only", async () => {
  process.env.INJI_VERIFY_URL = "http://verify.example:8080";
  process.env.INJI_VERIFY_CLIENT_ID = "did:web:verify.example";
  process.env.PLAYGROUND_TEST_UNRELATED_SECRET =
    "must-not-appear-in-component-response";

  for (const key of configKeys) {
    delete require.cache[key];
  }

  const app = express();
  app.use(
    "/api/components",
    require("../src/routes/component.routes")
  );

  const server = app.listen(0, "127.0.0.1");

  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/components`
    );
    const body = await response.json();
    const verifier = body.components.verifiers.find(
      (component) => component.id === "inji-verify"
    );

    assert.equal(response.status, 200);
    assert.equal(
      verifier.clientId,
      "did:web:verify.example"
    );
    assert.equal(
      JSON.stringify(body).includes(
        process.env.PLAYGROUND_TEST_UNRELATED_SECRET
      ),
      false
    );
  } finally {
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

test("loads the configured client ID through the component registry and verifier adapter", () => {
  process.env.INJI_VERIFY_URL = "http://verify.example:8080";
  process.env.INJI_VERIFY_CLIENT_ID =
    "  did:web:verify.example:v1:verify  ";

  const verifierService =
    loadVerifierServiceWithCurrentEnvironment();
  const verifierComponent =
    verifierService.getVerifierAdapter("inji-verify").config;

  assert.equal(verifierComponent.baseUrl, "http://verify.example:8080");
  assert.equal(
    verifierService.getVerifierClientId("inji-verify"),
    "did:web:verify.example:v1:verify"
  );
  assert.equal(
    verifierComponent.clientId,
    "did:web:verify.example:v1:verify"
  );
});

test("treats a missing or blank configured client ID as a configuration error", () => {
  process.env.INJI_VERIFY_CLIENT_ID = "  \t ";

  const verifierService =
    loadVerifierServiceWithCurrentEnvironment();

  assert.throws(
    () => verifierService.getVerifierClientId("inji-verify"),
    {
      code: "VERIFIER_CLIENT_ID_NOT_CONFIGURED",
      statusCode: 503
    }
  );
});

test("rejects a configured non-DID client ID for the real Verify flow", () => {
  process.env.INJI_VERIFY_CLIENT_ID = "test-verifier-client";

  const verifierService =
    loadVerifierServiceWithCurrentEnvironment();

  assert.throws(
    () => verifierService.getVerifierClientId("inji-verify"),
    {
      code: "VERIFIER_CLIENT_ID_NOT_DID",
      statusCode: 503
    }
  );
});
