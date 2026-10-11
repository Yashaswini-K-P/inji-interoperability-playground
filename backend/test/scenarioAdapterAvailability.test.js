const assert = require("node:assert/strict");
const express = require("express");
const test = require("node:test");

const scenarioRoutes = require("../src/routes/scenario.routes");

let server;
let baseUrl;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/scenarios", scenarioRoutes);

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

function scenario(wallet) {
  return {
    issuer: "inji-certify",
    wallet,
    verifier: "inji-verify",
    issuanceProtocol: "openid4vci",
    credentialFormat: "ldp_vc",
    presentationProtocol: "openid4vp"
  };
}

test("creates the supported Inji Certify, Mobile, Verify scenario", async () => {
  const response = await fetch(`${baseUrl}/api/scenarios`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(scenario("inji-mobile"))
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.success, true);
  assert.equal(body.scenario.configuration.wallet, "inji-mobile");
});

test("rejects a registered wallet without an adapter before creating a scenario", async () => {
  const response = await fetch(`${baseUrl}/api/scenarios`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(scenario("inji-web"))
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.deepEqual(body.details, [
    "Wallet Inji Web Wallet is registered but has no implemented adapter"
  ]);
});
