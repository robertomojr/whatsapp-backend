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

// Página simples para testar no navegador (sem terminal)
app.get("/test", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Teste OpenAI</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; }
          input { width: 100%; padding: 12px; font-size: 16px; }
          button { padding: 12px 16px; font-size: 16px; margin-top: 10px; }
          pre { background: #f4f4f4; padding: 12px; white-space: pre-wrap; }
        </style>
      </head>
      <body>
        <h2>Teste OpenAI (sem WhatsApp)</h2>
        <p>Digite uma pergunta e clique em Enviar.</p>
        <input id="msg" placeholder="Ex: explique o que é IA em uma frase" />
        <button onclick="send()">Enviar</button>
        <pre id="out"></pre>

        <script>
          async function send() {
            const message = document.getElementById('msg').value || "Diga olá";
            const out = document.getElementById('out');
            out.textContent = "Chamando IA...";

            try {
              const resp = await fetch('/webhook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message })
              });
              const data = await resp.json();
              out.textContent = data.reply || JSON.stringify(data, null, 2);
            } catch (e) {
              out.textContent = "Erro: " + e.message;
            }
          }
        </script>
      </body>
    </html>
  `);
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


