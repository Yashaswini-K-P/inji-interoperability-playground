const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    service: "Inji Interoperability Playground Backend",
    status: "running"
  });
});

module.exports = app;