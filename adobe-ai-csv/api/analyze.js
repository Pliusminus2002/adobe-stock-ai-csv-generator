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

You MUST choose the correct Adobe Stock category based on the MAIN SUBJECT of the image. Categories CAN repeat across images, but they MUST match the photo content.

Use this guide carefully:

1  Animals               – main subject is animals, wildlife, pets.
2  Buildings and Architecture – exterior or interior architecture, cityscapes, facades.
3  Business              – offices, finance, corporate, teamwork, meetings.
4  Drinks                – beverages as main subject (coffee, cocktails, water, juice).
5  The Environment       – ecology, pollution, climate, environmental issues.
6  States of Mind        – emotions, concepts like stress, happiness, sadness, mental states.
7  Food                  – food is the main subject (meals, ingredients, cooking scenes).
8  Graphic Resources     – icons, patterns, UI, templates, textures, abstract backgrounds.
9  Hobbies and Leisure   – hobbies, free time, games, relaxation.
10 Industry              – factories, production, industrial equipment.
11 Landscape             – nature scenes, mountains, fields, sky, sea, nature backgrounds.
12 Lifestyle             – daily life, home life, activities, people living their life.
13 People                – portrait, person/people clearly the main focus.
14 Plants and Flowers    – flowers, plants, trees as main subject.
15 Culture and Religion  – traditions, cultural symbols, religious subjects.
16 Science               – lab, experiments, technology as science, molecules, data.
17 Social Issues         – poverty, protests, inequality, social problems.
18 Sports                – sports activities, athletes, training.
19 Technology            – devices, digital tech, laptops, phones, servers, AI visuals.
20 Transport             – cars, trains, bikes, any vehicles as main subject.
21 Travel                – famous locations, landmarks, tourist places, travel concepts.

CATEGORY RULES:
- Choose EXACTLY ONE category (1–21).
- Category MUST match the main subject of the image.
- Do NOT choose category 13 (people) if no real person is visible.
- Do NOT choose category 12 (lifestyle) unless daily life / lifestyle is clearly the focus.
- If the scene is mostly nature, use 11 (landscape) or 14 (plants and flowers) if flowers/plants are the main close-up.
- If the scene is mostly architecture/city, prefer 2 (buildings and architecture) or 21 (travel) if it's a famous place.

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

Return ONLY pure JSON:

{
  "title": "string",
  "keywords": ["string", "..."],
  "category": 1
}

Filename (may help, but ignore if irrelevant):
${filename || "unknown"}
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

    // --- Robust JSON PARSE ---
    let parsedJson;
    try {
      const firstBrace = raw.indexOf("{");
      const lastBrace = raw.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const jsonSlice = raw.slice(firstBrace, lastBrace + 1);
        parsedJson = JSON.parse(jsonSlice);
      } else {
        throw new Error("No JSON object found in response");
      }
    } catch (e) {
      throw new Error("Failed to parse JSON from OpenAI");
    }

    // TITLE – nelaužom žodžių, max ~200 simbolių
    let title = (parsedJson.title || "").toString().trim();
    if (!title) title = "ai generated image";

    const MAX_TITLE_CHARS = 200;
    if (title.length > MAX_TITLE_CHARS) {
      const slice = title.slice(0, MAX_TITLE_CHARS);
      const lastSpace = slice.lastIndexOf(" ");
      if (lastSpace > 40) {
        title = slice.slice(0, lastSpace);
      } else {
        title = slice;
      }
    }

    // KEYWORDS – iki 49, unikalūs, be tuščių
    let keywordsArray = Array.isArray(parsedJson.keywords)
      ? parsedJson.keywords.map((k) => String(k).toLowerCase().trim())
      : [];
    keywordsArray = keywordsArray
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 49);

    // CATEGORY – AI privalo duoti 1–21, bet mes dar apsaugom
    let category = parseInt(parsedJson.category, 10);
    if (!Number.isInteger(category)) {
      // jei modelis visai nukvailiojo – geriau bent landscape kaip neutrali
      category = 11;
    } else if (category < 1) {
      category = 1;
    } else if (category > 21) {
      category = 21;
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
