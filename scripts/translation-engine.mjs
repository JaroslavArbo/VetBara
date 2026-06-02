export async function translateText({ provider = "mock", source, targetLanguage }) {
  if (!source && source !== "") {
    throw new Error("translateText requires source");
  }

  if (!targetLanguage) {
    throw new Error("translateText requires targetLanguage");
  }

  if (provider === "mock") {
    return `[${targetLanguage} draft] ${source}`;
  }

  if (provider === "openai") {
    return translateWithOpenAI({ source, targetLanguage });
  }

  throw new Error(`Unsupported translation provider: ${provider}`);
}

async function translateWithOpenAI({ source, targetLanguage }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_TRANSLATION_MODEL || "gpt-4.1-mini";

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required when provider=openai");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            "You are translating short UI strings for VetBara.",
            "Translate only the user-facing prose.",
            "Preserve every __VETBARA_*__ mask token exactly.",
            "Preserve placeholders such as {role}, {label}, {event}, {variants}, {questions}, {message}, and {variant} exactly if present.",
            "Return only the translated target text.",
            "Do not add quotes.",
            "Do not add explanations.",
          ].join(" "),
        },
        {
          role: "user",
          content: `Target language: ${targetLanguage}\nText:\n${source}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI translation failed: HTTP ${response.status} ${body}`);
  }

  const data = await response.json();

  const text =
    data.output_text ??
    data.output?.flatMap((item) => item.content ?? [])
      ?.find((content) => content.type === "output_text")?.text;

  if (typeof text !== "string") {
    throw new Error("OpenAI translation failed: unexpected response shape");
  }

  return text.trim();
}
