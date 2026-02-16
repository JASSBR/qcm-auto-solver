// background.js — Service worker handling AI API calls

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SOLVE_QCM") {
    solveQCM(msg.payload)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async response
  }
});

async function solveQCM({ questions, provider, apiKey, model }) {
  const prompt = buildPrompt(questions);

  if (provider === "anthropic") {
    return callAnthropic(prompt, apiKey, model);
  } else {
    return callOpenAI(prompt, apiKey, model);
  }
}

function buildPrompt(questions) {
  let text = `Tu es un assistant expert. On te donne des questions à choix multiples (QCM) extraites d'une page web.
Pour CHAQUE question, réponds avec le numéro de la question et la lettre (ou les lettres) de la bonne réponse.

IMPORTANT: Réponds UNIQUEMENT au format JSON suivant, sans aucun autre texte:
[
  {"question": 1, "answers": ["A"]},
  {"question": 2, "answers": ["B", "C"]}
]

Voici les questions:\n\n`;

  questions.forEach((q, i) => {
    text += `Question ${i + 1}: ${q.questionText}\n`;
    q.options.forEach((opt, j) => {
      const letter = String.fromCharCode(65 + j);
      text += `  ${letter}) ${opt.text}\n`;
    });
    text += "\n";
  });

  return text;
}

async function callAnthropic(prompt, apiKey, model) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-4-5-20250929",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error: ${res.status} — ${err}`);
  }

  const data = await res.json();
  const content = data.content?.[0]?.text || "";
  return parseAIResponse(content);
}

async function callOpenAI(prompt, apiKey, model) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error: ${res.status} — ${err}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";
  return parseAIResponse(content);
}

function parseAIResponse(text) {
  // Extract JSON from the response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("Could not parse AI response as JSON");
  }
  return JSON.parse(jsonMatch[0]);
}
