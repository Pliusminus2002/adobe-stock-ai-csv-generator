// api/analyze.js
// Vercel serverless funkcija, kuri kviečia OpenAI Responses API su vizija (ESM versija)

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Only POST allowed" }));
    return;
  }

  try {
    // --- body nuskaitymas iš stream'o ---
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    let parsed;
    try {
      parsed = JSON.parse(body || "{}");
    } catch (e) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return;
    }

    const { imageBase64, filename } = parsed;

    if (!imageBase64) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing imageBase64" }));
      return;
    }

    // Paprastas dydžio check: labai dideli vaizdai -> graži klaida
    if (imageBase64.length > 12 * 1024 * 1024) {
      res.statusCode = 413;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "Image too large",
          details: "Please upload images under ~8MB each."
        })
      );
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing OPENAI_API_KEY on server" }));
      return;
    }

    const prompt = `
You are a professional Adobe Stock top-seller metadata expert who knows how to optimize metadata for maximum search visibility and commercial sales.

Analyze the provided image and generate Adobe Stock metadata optimized for sales.

TITLE (max ~180 characters)
- Must improve search visibility.
- Simple, commercial tone.
- No emojis, hashtags, or quotes.
- Literal but optimized for search intent.

KEYWORDS (30–49)
- ORDER IS IMPORTANT: rank by commercial importance.
- Use search-intent keywords buyers actually use on stock sites.
- Avoid synonyms that add no search value.
- Avoid useless adjectives (beautiful, nice, lovely, soft, etc.).
- Avoid personal names, unknown brands, opinions.
- Use lowercase English only.

CATEGORY (1–21): choose by commercial intent, not artistic interpretation.

Return ONLY pure JSON:

{
  "title": "string",
  "keywords": ["string", "..."],
  "category": 1
}

Filename: ${filename || "unknown"}
    `.trim();

    // Responses API payload
    const payload = {
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: `data:image/jpeg;base64,${imageBase64}` }
          ]
        }
      ],
      max_output_tokens: 400
    };

    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!openaiRes.ok) {
      const text = await openaiRes.text().catch(() => "");
      throw new Error(`OpenAI API error: ${openaiRes.status} ${text}`);
    }

    const apiData = await openaiRes.json();

    // --- Extract text ---
    let raw = "";
    if (apiData.output_text) raw = apiData.output_text;
    else if (
      Array.isArray(apiData.output) &&
      apiData.output[0]?.content?.[0]?.text
    ) raw = apiData.output[0].content[0].text;

    raw = (raw || "").trim();
    if (!raw) throw new Error("Empty response from OpenAI");

    // --- Robust JSON PARSE ---
    let parsedJson;
    try {
      const firstBrace = raw.indexOf("{");
      const lastBrace = raw.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        parsedJson = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
      } else throw new Error("No JSON object found");
    } catch {
      throw new Error("Failed to parse JSON from OpenAI");
    }

    // Title
    let title = (parsedJson.title || "").toString().trim();
    if (!title) title = "ai generated image";

    const MAX_TITLE_CHARS = 200;
    if (title.length > MAX_TITLE_CHARS) {
      const slice = title.slice(0, MAX_TITLE_CHARS);
      const lastSpace = slice.lastIndexOf(" ");
      title = lastSpace > 40 ? slice.slice(0, lastSpace) : slice;
    }

    // Keywords (max 49)
    let keywordsArray = Array.isArray(parsedJson.keywords)
      ? parsedJson.keywords.map((k) => String(k).toLowerCase().trim())
      : [];
    keywordsArray = keywordsArray.filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 49);

    // Category
    let category = parseInt(parsedJson.category, 10);
    if (!Number.isInteger(category) || category < 1 || category > 21) category = 13;

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ title, keywords: keywordsArray, category }));

  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "AI analysis failed", details: err.message }));
  }
}
