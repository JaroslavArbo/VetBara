const TARGET_LANGUAGE_NAMES = {
  de: "German (Germany, standard orthography with ä, ö, ü, ß)",
  it: "Italian",
  sv: "Swedish",
  hr: "Croatian",
  nl: "Dutch",
  no: "Norwegian",
  fr: "French",
  es: "Spanish",
  ro: "Romanian",
};

const GERMAN_ASCII_TRANSLITERATION_PATTERNS = [
  /\bfuer\b/i,
  /\boeffnen\b/i,
  /\bschliessen\b/i,
  /\bbestaetigen\b/i,
  /\bwaehlen\b/i,
  /\bpruef/i,
  /\bueber/i,
  /\bmuessen\b/i,
  /\bkoennen\b/i,
  /\bzurueck/i,
];

function targetLanguageName(code) {
  return TARGET_LANGUAGE_NAMES[code] ?? code;
}

function assertNativeOrthography({ text, targetLanguage }) {
  if (targetLanguage !== "de") return;

  const matched = GERMAN_ASCII_TRANSLITERATION_PATTERNS.find((pattern) => pattern.test(text));
  if (matched) {
    throw new Error(
      `German translation appears to use ASCII transliteration instead of native diacritics: ${matched}`
    );
  }
}


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
            "Use native target-language characters and diacritics.",
            "For German, use standard German orthography with ä, ö, ü, and ß where linguistically appropriate.",
            "For German, never write ASCII transliterations such as ae, oe, ue, fuer, oeffnen, schliessen, Pruefung, or bestaetigen unless that exact spelling is inside a protected mask token.",
            "Return only the translated target text.",
            "Do not add quotes.",
            "Do not add explanations.",
          ].join(" "),
        },
        {
          role: "user",
          content: `Target language: ${targetLanguageName(targetLanguage)}\nText:\n${source}`,
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

  const trimmed = text.trim();
  assertNativeOrthography({ text: trimmed, targetLanguage });
  return trimmed;
}
