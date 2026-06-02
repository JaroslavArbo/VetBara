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

  throw new Error(`Unsupported translation provider: ${provider}`);
}
