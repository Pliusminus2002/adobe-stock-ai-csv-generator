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
You are a professional Adobe Stock top-seller metadata expert.

Analyze the ENTIRE image: main subject, background, context and overall commercial theme.
Your goal is to create metadata that helps the image SELL on Adobe Stock.

Return a JSON object with:
- a commercial, literal, search-optimized TITLE (max ~180 characters, no emojis, no hashtags, no quotes),
- exactly 40 strong, commercially relevant KEYWORDS,
- ONE Adobe Stock CATEGORY (1–21) that best matches the WHOLE scene and use case, not just one object.

Adobe Stock categories:

  1 Animals               – animals, pets, wildlife as main theme.
  2 Buildings and Architecture – architecture, buildings, interiors, cityscapes.
  3 Business              – office, corporate, finance, teamwork, professional life.
  4 Drinks                – beverages as main focus (coffee, tea, cocktails, etc.).
  5 The Environment       – ecology, nature protection, pollution, environmental issues.
  6 States of Mind        – emotional or conceptual mental states as main idea.
  7 Food                  – food, cooking, recipes, meals as main subject.
  8 Graphic Resources     – patterns, textures, icons, UI, templates, backgrounds.
  9 Hobbies and Leisure   – leisure, hobbies, games, fun, relaxation, seasonal crafts.
 10 Industry              – factories, work sites, industry machines, heavy production.
 11 Landscape             – wide nature views: mountains, fields, sky, sea, outdoor scenery.
 12 Lifestyle             – everyday life, home life, activities, product or home styling.
 13 People                – a person or people clearly the main focus (portraits, people shots).
 14 Plants and Flowers    – plants, trees, flowers as main focus, especially close-ups.
 15 Culture and Religion  – traditions, rituals, symbols of culture or religion.
 16 Science               – labs, experiments, molecules, science visuals.
 17 Social Issues         – protests, poverty, inequality, social problem themes.
 18 Sports                – sport activities, athletes, training.
 19 Technology            – devices, screens, digital tech, AI visuals, servers, code.
 20 Transport             – vehicles (cars, trains, planes, bikes) as main theme.
 21 Travel                – famous places, travel destinations, tourism, trip concepts.

IMPORTANT CATEGORY RULES:
- Categories can repeat across images.
- Category MUST match the overall scene and main commercial use.
- Do NOT choose 13 (people) if no real visible person.
- Do NOT choose 7 (food) or 4 (drinks) if there is no actual food or drink.
- Do NOT choose 11 (landscape) if the scene is a product still-life, decorations, or gift boxes.
- For seasonal decorations, gift boxes, ornaments, still-life styling → usually 12 (lifestyle) or 9 (hobbies and leisure), NOT animals / food / landscape.
- For nature scenes → prefer 11 (landscape) or 14 (plants and flowers) for close-ups.
- For architecture/city → prefer 2 (buildings) or 21 (travel) if it's a known destination.

KEYWORDS RULES:
- "keywords" array MUST contain exactly 40 items.
- Order from most important / general to more specific.
- Use search phrases buyers would actually type.
- Avoid useless adjectives and redundant synonyms.
- Use lowercase English only.
- No emojis, no hashtags.

Return ONLY pure JSON with this exact shape, nothing else:

{
  "title": "string",
  "keywords": ["string", "... 40 items total ..."],
  "category": 1
}

Filename (may help, but ignore if irrelevant):
${filename || "unknown"}
    `.trim();

    const payload = {
      model: "gpt-4.1", // stipresnis modelis, geriau "mato" vaizdus
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: `data:image/jpeg;base64,${imageBase64}` }
          ]
        }
      ],
      max_output_tokens: 500
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

    // --- Extract text from Responses API ---
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
    } catch {
      throw new Error("Failed to parse JSON from OpenAI");
    }

    // TITLE – nelaužom žodžių, max ~200 simbolių
    let title = (parsedJson.title || "").toString().trim();
    if (!title) title = "ai generated image";

    const MAX_TITLE_CHARS = 200;
    if (title.length > MAX_TITLE_CHARS) {
      const slice = title.slice(0, MAX_TITLE_CHARS);
      const lastSpace = slice.lastIndexOf(" ");
      title = lastSpace > 40 ? slice.slice(0, lastSpace) : slice;
    }

    // KEYWORDS – iki 49, unikalūs, be tuščių (bet modelio prašėm 40)
    let keywordsArray = Array.isArray(parsedJson.keywords)
      ? parsedJson.keywords.map((k) => String(k).toLowerCase().trim())
      : [];
    keywordsArray = keywordsArray
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 49);

    // CATEGORY – iš AI, tik apribojam 1–21
    let category = parseInt(parsedJson.category, 10);
    if (!Number.isInteger(category)) {
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
