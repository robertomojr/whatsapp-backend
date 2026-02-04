import express from "express";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

/**
 * =========================
 * Supabase client
 * =========================
 */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const app = express();
app.use(express.json());

/**
 * =========================
 * ENV VARS necessárias
 * =========================
 * WHATSAPP_VERIFY_TOKEN   -> token do webhook da Meta
 * OPENAI_API_KEY          -> chave da OpenAI
 *
 * (Opcional)
 * OPENAI_MODEL            -> ex: "gpt-4.1-mini"
 */

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

/**
 * =========================
 * OpenAI client
 * =========================
 */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * =========================
 * Helpers
 * =========================
 */

// Extrai mensagem de texto do payload do WhatsApp
function extractIncomingText(body) {
  const entry = body?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  const msg = value?.messages?.[0];
  if (!msg) return null;

  return {
    messageId: msg.id,
    from: msg.from,
    type: msg.type,
    text: msg?.text?.body || null,
    timestamp: msg.timestamp,
  };
}

// Chamada ao OpenAI
async function callBot(userText) {
  if (!userText) return "Não recebi texto para processar.";

  const systemPrompt =
    "Você é um assistente útil e objetivo. Responda em português do Brasil, com clareza, em até 8 linhas.";

  const resp = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ],
    temperature: 0.4,
  });

  return (
    resp?.choices?.[0]?.message?.content?.trim() ||
    "Não consegui gerar uma resposta agora."
  );
}

// Processa mensagem do WhatsApp + salva no Supabase
async function processIncomingWhatsAppMessage(payload) {
  try {
    const incoming = extractIncomingText(payload);

    if (!incoming) {
      console.log("ℹ️ Evento sem mensagem.");
      return;
    }

    if (incoming.type !== "text" || !incoming.text) {
      console.log("ℹ️ Mensagem não-texto ignorada.");
      return;
    }

    console.log("📩 WhatsApp recebido de:", incoming.from);
    console.log("📝 Texto:", incoming.text);

    const botReply = await callBot(incoming.text);
    console.log("🤖 Resposta simulada:", botReply);

    // Salva no Supabase
    const { error } = await supabase.from("wa_messages").upsert(
      {
        wa_message_id: incoming.messageId,
        from_number: incoming.from,
        received_text: incoming.text,
        received_at: incoming.timestamp
          ? new Date(Number(incoming.timestamp) * 1000).toISOString()
          : new Date().toISOString(),
        bot_simulated: botReply,
      },
      { onConflict: "wa_message_id" }
    );

    if (error) {
      console.error("❌ Erro ao salvar no Supabase:", error);
    } else {
      console.log("✅ Mensagem salva no Supabase");
    }
  } catch (err) {
    console.error("❌ Erro ao processar WhatsApp:", err);
  }
}

/**
 * =========================
 * Rotas básicas
 * =========================
 */

app.get("/", (req, res) => {
  res.status(200).send("Backend WhatsApp + OpenAI está vivo 🚀");
});

app.get("/test", (req, res) => {
  res.status(200).send("OK /test está vivo");
});

/**
 * =========================
 * ROTA DE TESTE – INSERT MANUAL
 * =========================
 */
app.get("/test-insert", async (req, res) => {
  const { error } = await supabase.from("wa_messages").insert({
    wa_message_id: "test-" + Date.now(),
    from_number: "+5511999999999",
    received_text: "Mensagem inserida via rota de teste",
    received_at: new Date().toISOString(),
    bot_simulated: "Resposta simulada pelo backend",
  });

  if (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error });
  }

  res.json({ ok: true });
});

/**
 * =========================
 * /ask – testar bot via browser
 * =========================
 */
app.post("/ask", async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message) {
      return res.status(400).json({ error: "Envie { message: \"...\" }" });
    }

    const reply = await callBot(message);
    res.json({ reply });
  } catch (err) {
    console.error("❌ Erro no /ask:", err);
    res.status(500).json({ error: "Falha ao chamar o bot" });
  }
});

/**
 * =========================
 * WhatsApp Webhook
 * =========================
 */

// Verificação do webhook
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// Receber mensagens
app.post("/webhook", (req, res) => {
  res.sendStatus(200);
  console.log("📩 Evento recebido:", JSON.stringify(req.body, null, 2));
  void processIncomingWhatsAppMessage(req.body);
});

/**
 * =========================
 * Start server
 * =========================
 */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Server rodando na porta ${PORT}`);
});
