const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const ANTHROPIC_API_KEY = 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 // 🔑 Replace with your key from https://console.anthropic.com

app.post("/api/messages", async (req, res) => {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3001, () => {
  console.log("✅ Proxy server running at http://localhost:3001");
});