const express = require("express");
const cors = require("cors");

const componentRoutes = require("./routes/component.routes");
const scenarioRoutes = require("./routes/scenario.routes");
const issuerRoutes = require("./routes/issuer.routes");
const issuanceRoutes = require("./routes/issuance.routes");
const runRoutes = require("./routes/run.routes");
const walletRoutes = require("./routes/wallet.routes");

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
app.use("/api/scenarios", scenarioRoutes);
app.use("/api/issuers", issuerRoutes);
app.use("/api/issuance", issuanceRoutes);
app.use("/api/runs", runRoutes);
app.use("/api/wallet", walletRoutes);

module.exports = app;