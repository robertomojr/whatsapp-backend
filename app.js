const express = require("express");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

// cliente OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// rota raiz
app.get("/", (req, res) => {
  res.send("Backend WhatsApp + OpenAI está vivo 🚀");
});

// rota que simula webhook do WhatsApp
app.post("/webhook", async (req, res) => {
  try {
    const userMessage = req.body.message || "Diga olá";

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "Você é um assistente curto, educado e objetivo. Responda em português do Brasil.",
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    res.json({
      ok: true,
      reply: completion.choices[0].message.content,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      error: "Erro ao chamar OpenAI",
    });
  }
});

// porta usada pelo Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor rodando na porta", PORT);
});


