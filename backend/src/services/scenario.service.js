const crypto = require("crypto");

const scenarios = new Map();

function createScenario(configuration) {
  const id = `RUN-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

  const scenario = {
    id,
    status: "CREATED",
    configuration,
    createdAt: new Date().toISOString()
  };

  scenarios.set(id, scenario);

  return scenario;
}

function getScenario(id) {
  return scenarios.get(id);
}

function getAllScenarios() {
  return Array.from(scenarios.values());
}

module.exports = {
  createScenario,
  getScenario,
  getAllScenarios
};