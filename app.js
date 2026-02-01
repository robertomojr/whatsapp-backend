import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());

// cliente OpenAI (usa variável de ambiente)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// rota raiz (teste simples)
app.get("/", (req, res) => {
  res.send("Backend WhatsApp + OpenAI está vivo 🚀");
});

// rota que simula o webhook do WhatsApp
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

    const reply = completion.choices[0].message.content;

    res.json({
      ok: true,
      reply,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: "Erro ao chamar OpenAI" });
  }
});

// porta definida pelo Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor rodando na porta", PORT);
});
