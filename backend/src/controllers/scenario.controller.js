const {
  createScenario,
  getScenario,
  getAllScenarios
} = require("../services/scenario.service");

const {
  validateScenario
} = require("../engine/compatibility.engine");

function create(req, res) {
  const validation = validateScenario(req.body);

  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      error: "Invalid scenario configuration",
      details: validation.errors
    });
  }
  const scenario = createScenario(req.body);

  res.status(201).json({
    success: true,
    scenario
  });
}

function getById(req, res) {
  const scenario = getScenario(req.params.id);

  if (!scenario) {
    return res.status(404).json({
      success: false,
      error: "Scenario not found"
    });
  }

  res.json({
    success: true,
    scenario
  });
}

function getAll(req, res) {
  res.json({
    success: true,
    scenarios: getAllScenarios()
  });
}

module.exports = {
  create,
  getById,
  getAll
};