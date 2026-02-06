import express from "express";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

/**
 * =========================
 * App
 * =========================
 */
const app = express();
app.use(express.json());

/**
 * =========================
 * ENV
 * =========================
 */
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || "";
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const SEND_WHATSAPP = (process.env.SEND_WHATSAPP || "false") === "true";

/**
 * =========================
 * Clients
 * =========================
 */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * =========================
 * Helpers
 * =========================
 */
function extractIncomingText(body) {
  const entry = body?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const msg = value?.messages?.[0];
  if (!msg) return null;

  return {
    messageId: msg.id,
    from: msg.from, // wa_id do remetente
    type: msg.type,
    text: msg?.text?.body || null,
    timestamp: msg.timestamp, // string unix (segundos)
  };
}

async function callBot(userText) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY não está configurada.");
  }
  if (!userText || typeof userText !== "string") {
    return "Não recebi texto para processar.";
  }

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

async function sendWhatsAppText(to, text) {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error(
      "Env vars ausentes: WHATSAPP_ACCESS_TOKEN e/ou WHATSAPP_PHONE_NUMBER_ID."
    );
  }

  const url = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await resp.json();

  if (!resp.ok) {
    const msg = data?.error?.message || "Erro desconhecido";
    const code = data?.error?.code;
    const subcode = data?.error?.error_subcode;
    throw new Error(
      `WhatsApp send failed: ${msg} (code=${code}, subcode=${subcode})`
    );
  }

  return data;
}

/**
 * Salva duas linhas no Supabase:
 * - IN: mensagem do usuário
 * - OUT: mensagem do bot
 */
async function saveInOutToSupabase({ incoming, botReply }) {
  const receivedAt = incoming.timestamp
    ? new Date(Number(incoming.timestamp) * 1000).toISOString()
    : new Date().toISOString();

  const inRow = {
    wa_message_id: incoming.messageId,
    from_number: incoming.from,
    received_text: incoming.text,
    received_at: receivedAt,
    direction: "in",
  };

  const outRow = {
    wa_message_id: `bot-${incoming.messageId}`,
    from_number: incoming.from,
    received_text: botReply,
    received_at: new Date().toISOString(),
    direction: "out",
  };

  const { error } = await supabase
    .from("wa_messages")
    .upsert([inRow, outRow], { onConflict: "wa_message_id" });

  if (error) throw error;
}

async function processIncomingWhatsAppMessage(payload) {
  try {
    const incoming = extractIncomingText(payload);

    if (!incoming) {
      console.log("ℹ️ Webhook recebido sem messages (provável status/evento).");
      return;
    }

    console.log("✅ Mensagem recebida via WhatsApp!");
    console.log("from:", incoming.from);
    console.log("type:", incoming.type);
    console.log("text:", incoming.text);

    if (incoming.type !== "text" || !incoming.text) {
      console.log("ℹ️ Mensagem não-texto. Ignorando por enquanto.");
      return;
    }

    // 1) gera resposta
    const botReply = await callBot(incoming.text);
    console.log("🤖 Resposta do bot:", botReply);

    // 2) salva IN + OUT no Supabase
    try {
      await saveInOutToSupabase({ incoming, botReply });
      console.log("✅ IN/OUT salvos no Supabase");
    } catch (dbErr) {
      console.error("❌ Erro ao salvar no Supabase:", dbErr);
    }

    // 3) envia WhatsApp (opcional)
    if (!SEND_WHATSAPP) {
      console.log("🚫 Envio WhatsApp desligado (SEND_WHATSAPP=false).");
      return;
    }

    try {
      const sendResult = await sendWhatsAppText(incoming.from, botReply);
      console.log("✅ WhatsApp enviado:", JSON.stringify(sendResult));
    } catch (sendErr) {
      console.error("❌ Falha ao enviar WhatsApp:", sendErr?.message || sendErr);
    }
  } catch (err) {
    console.error("❌ Erro geral ao processar mensagem:", err?.message || err);
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
 * Teste do bot via browser/Postman
 */
app.post("/ask", async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Envie { message: \"...\" }" });
    }

    const reply = await callBot(message);
    return res.status(200).json({ reply });
  } catch (err) {
    console.error("❌ Erro no /ask:", err?.message || err);
    return res.status(500).json({ error: "Falha ao chamar o bot" });
  }
});

/**
 * Rota para testar gravação no Supabase (IN + OUT)
 */
app.get("/test-insert", async (req, res) => {
  try {
    const fakeIncoming = {
      messageId: `test-${Date.now()}`,
      from: "+5511999999999",
      text: "Mensagem inserida via rota de teste",
      timestamp: String(Math.floor(Date.now() / 1000)),
    };

    const botReply = "Resposta simulada pelo backend";

    await saveInOutToSupabase({ incoming: fakeIncoming, botReply });

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ Erro no /test-insert:", err);
    return res.status(500).json({ ok: false, error: err?.message || err });
  }
});

/**
 * =========================
 * WhatsApp Webhook
 * =========================
 */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado com sucesso!");
    return res.status(200).send(challenge);
  }

  console.log("❌ Falha na verificação do webhook");
  return res.sendStatus(403);
});

app.post("/webhook", (req, res) => {
  // responde rápido para a Meta
  res.sendStatus(200);

  // log útil no começo (pode tirar depois)
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
