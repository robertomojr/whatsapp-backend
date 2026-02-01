import express from "express";

const app = express();
app.use(express.json());

// Healthcheck simples
app.get("/", (req, res) => {
  res.status(200).send("Backend WhatsApp + OpenAI está vivo 🚀");
});

// (Opcional) sua página /test (se você já tem, pode manter a sua)
app.get("/test", (req, res) => {
  res.status(200).send("OK /test está vivo");
});

/**
 * ✅ WEBHOOK VERIFY (Passo B da Meta)
 * Meta chama GET /webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado com sucesso!");
    return res.status(200).send(challenge);
  }

  console.log("❌ Falha na verificação do webhook");
  return res.sendStatus(403);
});

/**
 * ✅ RECEBER EVENTOS (mensagens entrando)
 * Meta manda POST /webhook com um JSON
 */
app.post("/webhook", (req, res) => {
  // Importante: responder rápido 200 pra Meta não ficar reenviando
  res.sendStatus(200);

  try {
    const body = req.body;
    console.log("📩 Evento recebido:", JSON.stringify(body, null, 2));

    // Aqui a gente vai tratar mensagens depois (Passo seguinte)
    // Por enquanto, só logar já resolve para validar o fluxo.
  } catch (err) {
    console.error("Erro ao processar webhook:", err);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Server rodando na porta ${PORT}`);
});
