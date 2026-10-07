const components = require("../config/components");

function getAllComponents() {
  return components;
}

function getComponentsByType(type) {
  return components[type] || [];
}

function getComponentById(type, id) {
  const list = components[type] || [];

  return list.find((component) => component.id === id);
}

module.exports = {
  getAllComponents,
  getComponentsByType,
  getComponentById
};