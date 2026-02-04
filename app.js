import express from "express";
import OpenAI from "openai";

import { createClient } from "@supabase/supabase-js";

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
 * WHATSAPP_VERIFY_TOKEN   -> o mesmo token que você colocou no painel da Meta (webhook verify)
 * OPENAI_API_KEY          -> sua chave da OpenAI
 *
 * (Opcional)
 * OPENAI_MODEL            -> ex: "gpt-4.1-mini" (default abaixo)
 */

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

// Cliente OpenAI (SDK oficial npm: openai)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * =========================
 * Helpers
 * =========================
 */

// Extrai a mensagem (texto) do payload do WhatsApp Cloud API
function extractIncomingText(body) {
  const entry = body?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  const msg = value?.messages?.[0];
  if (!msg) return null;

  const from = msg.from; // wa_id do remetente
  const type = msg.type;
  const text = msg?.text?.body || null;

  return {
    from,
    type,
    text,
    rawMessage: msg,
    metadata: value?.metadata || null,
  };
}

// Chama o bot (OpenAI) e devolve um texto
async function callBot(userText) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY não está configurada no ambiente.");
  }
  if (!userText || typeof userText !== "string") {
    return "Não recebi texto para processar.";
  }

  // Você pode ajustar o "system" para o seu caso (ex: bot de atendimento)
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

  const answer = resp?.choices?.[0]?.message?.content?.trim();
  return answer || "Não consegui gerar uma resposta agora.";
}

// Apenas para logar “o bot rodou” quando chegar mensagem no WhatsApp
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

    // Por enquanto, vamos só processar TEXTO
    if (incoming.type !== "text" || !incoming.text) {
      console.log("ℹ️ Mensagem não-texto. Ignorando por enquanto.");
      return;
    }

    // Chama o bot e loga a resposta (sem enviar pro WhatsApp ainda)
    const botReply = await callBot(incoming.text);
    console.log("🤖 Resposta do bot (não enviada ao WhatsApp):", botReply);
  } catch (err) {
    console.error("❌ Erro ao processar mensagem do WhatsApp:", err?.message || err);
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
 * Opção A (mais limpa): /ask
 * Testar o bot via browser/Postman
 * =========================
 *
 * Exemplo (curl):
 * curl -X POST https://SEU_URL/ask \
 *  -H "Content-Type: application/json" \
 *  -d '{"message":"me explique o que é vício em trabalho"}'
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
 * =========================
 * WhatsApp Webhook
 * =========================
 */

/**
 * ✅ WEBHOOK VERIFY (Meta chama GET /webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...)
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

/**
 * ✅ RECEBER EVENTOS (mensagens entrando)
 * Meta manda POST /webhook com JSON
 */
app.post("/webhook", (req, res) => {
  // Responde rápido 200 pra Meta não ficar reenviando
  res.sendStatus(200);

  const body = req.body;

  // Log completo (útil no começo)
  console.log("📩 Evento recebido:", JSON.stringify(body, null, 2));

  // Processa em "background" (sem travar o retorno)
  // OBS: isso NÃO é um job real; apenas não aguarda o await aqui
  void processIncomingWhatsAppMessage(body);
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

