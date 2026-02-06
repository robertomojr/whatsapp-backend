import express from "express";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

/**
 * =========================
 * ENV VARS
 * =========================
 */
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || "";
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const SEND_WHATSAPP = (process.env.SEND_WHATSAPP || "false") === "true";

/**
 * =========================
 * Clients
 * =========================
 */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
    from: msg.from,
    type: msg.type,
    text: msg?.text?.body || null,
    timestamp: msg.timestamp,
  };
}

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

/**
 * Envia texto via WhatsApp Cloud API
 */
async function sendWhatsAppText(to, text) {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error("WHATSAPP_ACCESS_TOKEN ou WHATSAPP_PHONE_NUMBER_ID ausente.");
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
    // Erro vindo da Meta
    const msg = data?.error?.message || "Erro desconhecido ao enviar WhatsApp";
    const code = data?.error?.code;
    const subcode = data?.error?.error_subcode;
    throw new Error(`WhatsApp send failed: ${msg} (code=${code}, subcode=${subcode})`);
  }

  return data;
}

/**
 * Processa mensagem: gera resposta, salva no Supabase e (opcional) envia WhatsApp
 */
async function processIncomingWhatsAppMessage(payload) {
  try {
    const incoming = extractIncomingText(payload);
    if (!incoming) return;

    if (incoming.type !== "text" || !incoming.text) {
      console.log("ℹ️ Mensagem não-texto ignorada.");
      return;
    }

    console.log("📩 WhatsApp recebido de:", incoming.from);
    console.log("📝 Texto:", incoming.text);

    const botReply = await callBot(incoming.text);
    console.log("🤖 Resposta do bot:", botReply);

    // 1) Salva no Supabase (sempre)
    const { error: dbError } = await supabase.from("wa_messages").upsert(
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

    if (dbError) {
      console.error("❌ Erro ao salvar no Supabase:", dbError);
    } else {
      console.log("✅ Mensagem salva no Supabase");
    }

    // 2) Tenta enviar WhatsApp (só se ligado)
    if (!SEND_WHATSAPP) {
      console.log("🚫 Envio WhatsApp desligado (SEND_WHATSAPP=false).");
      return;
    }

    try {
      const result = await sendWhatsAppText(incoming.from, botReply);
      console.log("✅ WhatsApp enviado:", JSON.stringify(result));
    } catch (sendErr) {
      console.error("❌ Falha ao enviar WhatsApp:", sendErr?.message || sendErr);
      // mantém o sistema funcionando mesmo com restrição
    }
  } catch (err) {
    console.error("❌ Erro geral no processamento:", err?.message || err);
  }
}

/**
 * =========================
 * Rotas
 * =========================
 */
app.get("/", (req, res) => res.status(200).send("Backend WhatsApp + OpenAI está vivo 🚀"));
app.get("/test", (req, res) => res.status(200).send("OK /test está vivo"));

app.get("/test-insert", async (req, res) => {
  const { error } = await supabase.from("wa_messages").insert({
    wa_message_id: "test-" + Date.now(),
    from_number: "+5511999999999",
    received_text: "Mensagem inserida via rota de teste",
    received_at: new Date().toISOString(),
    bot_simulated: "Resposta simulada pelo backend",
  });

  if (error) return res.status(500).json({ ok: false, error });
  res.json({ ok: true });
});

app.post("/ask", async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: "Envie { message: \"...\" }" });
    const reply = await callBot(message);
    return res.status(200).json({ reply });
  } catch (err) {
    console.error("❌ Erro no /ask:", err?.message || err);
    return res.status(500).json({ error: "Falha ao chamar o bot" });
  }
});

// Webhook verify
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

// Webhook receive
app.post("/webhook", (req, res) => {
  res.sendStatus(200);
  void processIncomingWhatsAppMessage(req.body);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Server rodando na porta ${PORT}`));

