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

Analyze the provided image and generate Adobe Stock metadata optimized for sales, not just descriptive or artistic interpretation.

Rules for the result:

TITLE
- Must improve search visibility.
- Commercial, simple, literal, professional tone.
- Max 70 characters.
- No emojis, no hashtags, no quotes, no extra adjectives.

KEYWORDS (30–49 total)
- ORDER IS IMPORTANT: rank by commercial importance (most-demanded first).
- Use search-intent keywords buyers actually search for on stock platforms.
- Avoid synonyms that mean the same thing if they don't add distinct search value.
- Avoid useless adjectives (e.g., "beautiful", "nice", "soft", "lovely").
- Avoid personal names, unknown brands, subjective opinions.
- Include a mix from broad to specific (e.g., “christmas”, “winter holiday”, “snowman decoration”).
- Use lowercase English only.

CATEGORY (1–21)
Choose the category that buyers would most likely search for this image under (commercial usage intent):

  1 Animals
  2 Buildings and Architecture
  3 Business
  4 Drinks
  5 The Environment
  6 States of Mind
  7 Food
  8 Graphic Resources
  9 Hobbies and Leisure
  10 Industry
  11 Landscape
  12 Lifestyle
  13 People
  14 Plants and Flowers
  15 Culture and Religion
  16 Science
  17 Social Issues
  18 Sports
  19 Technology
  20 Transport
  21 Travel

Return ONLY a pure JSON object with this exact shape, nothing else:

{
  "title": "string",
  "keywords": ["string", "..."],
  "category": 1
}

Use the filename only if it provides useful context.
Filename: ${filename || "unknown"}
    `.trim();

    // Responses API payload – be response_format, JSON parsinam patys
    const payload = {
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt
            },
            {
              type: "input_image",
              image_url: `data:image/jpeg;base64,${imageBase64}`
            }
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
      console.error("OpenAI API error:", openaiRes.status, text);
      throw new Error(`OpenAI API error: ${openaiRes.status} ${text}`);
    }

    const apiData = await openaiRes.json();

    // Responses API output extraction – bandome kelis variantus
    let raw = "";
    if (apiData.output_text) {
      raw = apiData.output_text;
    } else if (
      Array.isArray(apiData.output) &&
      apiData.output[0]?.content?.[0]?.text
    ) {
      raw = apiData.output[0].content[0].text;
    }

    raw = (raw || "").trim();
    if (!raw) {
      throw new Error("Empty response from OpenAI");
    }

    let parsedJson;
    try {
      parsedJson = JSON.parse(raw);
    } catch (e) {
      console.error("JSON parse error, raw:", raw);
      throw new Error("Failed to parse JSON from OpenAI");
    }

    let title = (parsedJson.title || "").toString().trim();
    if (!title) title = "ai generated image";
    if (title.length > 70) title = title.slice(0, 70);

    let keywordsArray = Array.isArray(parsedJson.keywords)
      ? parsedJson.keywords.map((k) => String(k).toLowerCase().trim())
      : [];
    keywordsArray = keywordsArray
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 50);

    let category = parseInt(parsedJson.category, 10);
    if (!Number.isInteger(category) || category < 1 || category > 21) {
      category = 13; // People kaip default
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        title,
        keywords: keywordsArray,
        category
      })
    );
  } catch (err) {
    console.error("AI analysis failed:", err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "AI analysis failed",
        details: err.message || String(err)
      })
    );
  }
}
