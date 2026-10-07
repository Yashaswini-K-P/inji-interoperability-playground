const express = require("express");
const cors = require("cors");

const componentRoutes = require("./routes/component.routes");

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

app.use("/api/components", componentRoutes);

module.exports = app;