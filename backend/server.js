const path = require("path");

require("dotenv").config({
  path: path.join(__dirname, ".env")
});

const app = require("./src/app");

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(
    `Playground backend running on http://localhost:${PORT}`
  );
});