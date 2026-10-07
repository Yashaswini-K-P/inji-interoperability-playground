const express = require("express");

const {
  getAllComponents,
  getComponentsByType,
  getComponentById
} = require("../services/componentRegistry.service");

const router = express.Router();

router.get("/", (req, res) => {
  res.json({
    success: true,
    components: getAllComponents()
  });
});

router.get("/:type", (req, res) => {
  const { type } = req.params;

  const allowedTypes = ["issuers", "wallets", "verifiers"];

  if (!allowedTypes.includes(type)) {
    return res.status(400).json({
      success: false,
      error: "Invalid component type"
    });
  }

  res.json({
    success: true,
    type,
    components: getComponentsByType(type)
  });
});

router.get("/:type/:id", (req, res) => {
  const { type, id } = req.params;

  const component = getComponentById(type, id);

  if (!component) {
    return res.status(404).json({
      success: false,
      error: "Component not found"
    });
  }

  res.json({
    success: true,
    component
  });
});

module.exports = router;