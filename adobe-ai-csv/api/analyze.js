export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Only POST allowed" }));
    return;
  }

  try {
    // --- body nuskaitymas ---
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }
    const { imageBase64, filename } = JSON.parse(body || "{}");

    if (!imageBase64) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing imageBase64" }));
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
You are an expert Adobe Stock contributor assistant.

Look at the image and create metadata for Adobe Stock CSV:
- "title": short, natural English title, max 70 characters, no hashtags, no quotes.
- "keywords": 30–50 keywords in English, array of strings, most important first, no duplicates.
- "category": integer 1–21 according to Adobe Stock categories:
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

Rules:
- Answer ONLY a JSON object, nothing else.
- JSON shape:

{
  "title": "string",
  "keywords": ["string", ...],
  "category": 1
}

If the filename gives useful hints, you can use it too.
Filename: ${filename || "unknown"}
    `.trim();

    const payload = {
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a strict JSON generator. Always respond with a single valid JSON object, no extra text.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
      max_tokens: 400,
      temperature: 0.4,
    };

    // --- kviečiam OpenAI per fetch ---
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!openaiRes.ok) {
      const text = await openaiRes.text();
      throw new Error(`OpenAI API error: ${openaiRes.status} ${text}`);
    }

    const data = await openaiRes.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) {
      throw new Error("Empty response from OpenAI");
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error("JSON parse error, raw:", raw);
      throw new Error("Failed to parse JSON from OpenAI");
    }

    const title = String(parsed.title || "").slice(0, 70);
    const keywordsArray = Array.isArray(parsed.keywords)
      ? parsed.keywords.map((k) => String(k)).slice(0, 50)
      : [];
    const category =
      typeof parsed.category === "number" ? parsed.category : 12;

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        title,
        keywords: keywordsArray,
        category,
      })
    );
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "AI analysis failed",
        details: err.message || String(err),
      })
    );
  }
}
