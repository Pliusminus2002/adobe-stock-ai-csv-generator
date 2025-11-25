// api/analyze.js
// Vercel serverless funkcija, kuri kviečia OpenAI Responses API su vizija (CommonJS versija)

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

module.exports = async function handler(req, res) {
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
You are an expert Adobe Stock contributor assistant.

Look at the image and create metadata for Adobe Stock CSV:
- "title": short, natural English title, max 70 characters, no hashtags, no quotes, no emojis.
- "keywords": 30–50 keywords in English, array of strings, most important first, no duplicates, no emojis.
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

Return ONLY valid JSON, nothing else.
JSON shape:

{
  "title": "string",
  "keywords": ["string", "..."],
  "category": 1
}

If the filename gives useful hints, you can use it too.
Filename: ${filename || "unknown"}
    `.trim();

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
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`
              }
            }
          ]
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "stock_meta",
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              keywords: {
                type: "array",
                items: { type: "string" }
              },
              category: { type: "integer" }
            },
            required: ["title", "keywords", "category"],
            additionalProperties: false
          }
        }
      },
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

    // Responses API output extraction
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
    if (!title) title = "AI generated image";
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
};
