// api/analyze.js
// Vercel serverless funkcija, kuri kviečia OpenAI Responses API su vizija (ESM versija)

// Papildoma funkcija: nusprendžiam kategoriją pagal title + keywords
function decideCategory(title, keywordsArray, aiCategory) {
  const text = (title + " " + keywordsArray.join(" ")).toLowerCase();

  // Helper, kad būtų patogiau tikrinti žodžius
  const hasAny = (words) => words.some((w) => text.includes(w));

  // 1 – Animals
  if (hasAny([
    "cat","dog","animal","animals","pet","pets","wildlife","lion","tiger","bird","birds",
    "horse","fox","wolf","bear","owl","deer","rabbit","bunny","fish","shark","whale"
  ])) {
    return 1;
  }

  // 14 – Plants and Flowers (makro, augalai)
  if (hasAny([
    "flower","flowers","bloom","blossom","rose","tulip","sunflower","daisy","lavender",
    "plant","plants","leaf","leaves","foliage","botanical","greenery"
  ]) && !hasAny(["landscape","mountain","valley","panorama","wide view"])) {
    return 14;
  }

  // 11 – Landscape (gamta, peizažai)
  if (hasAny([
    "landscape","mountain","mountains","hill","hills","valley","sky","clouds","sunset","sunrise",
    "forest","woods","sea","ocean","lake","river","coast","beach","nature","scenery","outdoor","countryside","field","meadow","desert"
  ])) {
    return 11;
  }

  // 21 – Travel (vietovės, kelionės, žymios vietos)
  if (hasAny([
    "tourism","travel","destination","landmark","cityscape","skyline","old town","historic center",
    "eiffel","colosseum","taj mahal","paris","rome","london","new york","nyc","tokyo"
  ])) {
    return 21;
  }

  // 2 – Buildings and Architecture
  if (hasAny([
    "architecture","building","buildings","facade","skyscraper","interior","exterior",
    "church","cathedral","castle","bridge","street","city street","apartment","office building"
  ]) && !hasAny(["travel","tourism","destination"])) {
    return 2;
  }

  // 13 – People (kai žmonės aiškiai pagrindinis objektas)
  if (hasAny([
    "portrait","person","people","woman","man","girl","boy","child","children","kid","model",
    "face","faces","couple","family","friends","selfie","smiling person","young woman","young man"
  ])) {
    return 13;
  }

  // 12 – Lifestyle (gyvenimo būdas, kasdienybė)
  if (hasAny([
    "lifestyle","at home","home interior","cozy","relaxing at home","daily life","everyday life",
    "morning routine","evening routine","family time","weekend","home office","living room","kitchen scene"
  ])) {
    return 12;
  }

  // 3 – Business
  if (hasAny([
    "business","office","corporate","startup","meeting","teamwork","presentation","manager",
    "finance","financial","marketing","strategy","charts","graph","analytics","coworking"
  ])) {
    return 3;
  }

  // 7 – Food
  if (hasAny([
    "food","meal","dish","cooking","recipe","kitchen","breakfast","lunch","dinner",
    "pizza","burger","salad","pasta","dessert","cake","cookies","bread","baking","ingredients"
  ])) {
    return 7;
  }

  // 4 – Drinks
  if (hasAny([
    "coffee","tea","cocktail","beer","wine","drink","drinks","beverage","smoothie","juice","latte","cup","mug","glass of"
  ])) {
    return 4;
  }

  // 18 – Sports
  if (hasAny([
    "sport","sports","training","fitness","gym","workout","exercise",
    "football","soccer","basketball","tennis","running","jogging","yoga"
  ])) {
    return 18;
  }

  // 19 – Technology
  if (hasAny([
    "technology","tech","laptop","computer","tablet","smartphone","phone","screen","monitor",
    "server","data center","code","coding","programming","ai","artificial intelligence",
    "neural network","digital","cyber","futuristic","vr","ar"
  ])) {
    return 19;
  }

  // 8 – Graphic Resources (pattern, background, abstract)
  if (hasAny([
    "pattern","seamless","background","texture","abstract","wallpaper","gradient","design element",
    "template","frame","border","icon set","ui kit","infographic","mockup"
  ])) {
    return 8;
  }

  // 10 – Industry
  if (hasAny([
    "factory","industrial","industry","manufacturing","warehouse","construction site",
    "worker in factory","power plant","heavy machinery","production line"
  ])) {
    return 10;
  }

  // 5 – The Environment
  if (hasAny([
    "pollution","smog","trash","garbage","waste","environmental","climate change",
    "global warming","forest fire","deforestation","recycling","recycle"
  ])) {
    return 5;
  }

  // 17 – Social Issues
  if (hasAny([
    "protest","activism","homeless","poverty","inequality","violence","social issue",
    "racism","discrimination","refugees"
  ])) {
    return 17;
  }

  // 16 – Science
  if (hasAny([
    "laboratory","lab","scientist","microscope","test tube","experiment",
    "dna","molecule","molecular","formula","science"
  ])) {
    return 16;
  }

  // 15 – Culture and Religion
  if (hasAny([
    "religion","religious","church service","mosque","temple","bible","cross","prayer",
    "cultural festival","tradition","traditional costume"
  ])) {
    return 15;
  }

  // 9 – Hobbies and Leisure
  if (hasAny([
    "hobby","hobbies","leisure","relaxation","reading","gaming","video game",
    "crafts","handmade","knitting","sewing","painting","drawing"
  ])) {
    return 9;
  }

  // jei niekas normaliai „neužkabino“, paliekam AI kategoriją, bet apribojam 1–21
  let category = parseInt(aiCategory, 10);
  if (!Number.isInteger(category)) category = 11;
  if (category < 1) category = 1;
  if (category > 21) category = 21;
  return category;
}

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

Your task is to analyze the ENTIRE image (main subject, background, context, overall theme) and then choose ONE Adobe Stock category that best fits the whole scene and commercial usage, not just one object.

Think internally about:
- main subject,
- secondary elements,
- overall scene theme,
- what a buyer would search for.

Then output JSON ONLY:

{
  "title": "string",
  "keywords": ["string", "..."],
  "category": 1
}

Filename (may help, but ignore if irrelevant):
${filename || "unknown"}
    `.trim();

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

    // TITLE
    let title = (parsedJson.title || "").toString().trim();
    if (!title) title = "ai generated image";
    const MAX_TITLE_CHARS = 200;
    if (title.length > MAX_TITLE_CHARS) {
      const slice = title.slice(0, MAX_TITLE_CHARS);
      const lastSpace = slice.lastIndexOf(" ");
      title = lastSpace > 40 ? slice.slice(0, lastSpace) : slice;
    }

    // KEYWORDS
    let keywordsArray = Array.isArray(parsedJson.keywords)
      ? parsedJson.keywords.map((k) => String(k).toLowerCase().trim())
      : [];
    keywordsArray = keywordsArray
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 49);

    // AI kategorija iš modelio
    let aiCategory = parsedJson.category;

    // MŪSŲ logika – perrašom kategoriją pagal visą sceną
    const finalCategory = decideCategory(title, keywordsArray, aiCategory);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        title,
        keywords: keywordsArray,
        category: finalCategory
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
