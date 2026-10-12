const express = require("express");
const cors = require("cors");
const path = require("path");
const cheerio = require("cheerio");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3002;

// Comprehensive mock context to perfectly mimic the Vega App's sandbox
const mockContext = {
  fetch: global.fetch,
  load: cheerio.load,
  cheerio: cheerio,
  axios: axios,

  providerFetch: async (url, options = {}) => {
    const response = await axios({
      url,
      method: options.method || "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        ...options.headers,
      },
      data: options.data,
      responseType: options.responseType || "text",
      maxRedirects: 5,
      validateStatus: () => true,
    });

    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data: response.data,
    };
  },

  commonHeaders: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  },
};

// Helper to dynamically load compiled provider modules
async function getProviderModule(providerName, moduleName) {
  try {
    const modulePath = path.join(
      __dirname,
      "dist",
      providerName,
      `${moduleName}.js`,
    );
    return require(modulePath);
  } catch (e) {
    console.error(
      `❌ Failed to load ${providerName}/${moduleName}:`,
      e.message,
    );
    return null;
  }
}

// ==========================================
// 0. GET PROVIDERS LIST (from manifest.json)
// ==========================================
app.get("/api/providers", async (req, res) => {
  try {
    // Adjust this path if your manifest.json is located somewhere else
    const manifestPath = path.join(__dirname, "manifest.json");
    const manifestData = require(manifestPath);

    // Handle both array format and object with a 'providers' array
    const providers = Array.isArray(manifestData)
      ? manifestData
      : manifestData.providers || [];

    res.json(providers);
  } catch (error) {
    console.error("❌ Failed to read manifest.json:", error.message);
    res.status(500).json({ error: "Failed to load providers manifest" });
  }
});

// 1. GET CATALOG
app.get("/api/catalog", async (req, res) => {
  const { provider } = req.query;
  if (!provider) return res.status(400).json({ error: "Provider is required" });

  const module = await getProviderModule(provider, "catalog");
  if (!module || !module.catalog) {
    return res
      .status(404)
      .json({ error: "Catalog not found for this provider" });
  }
  res.json(module.catalog);
});

// 2. GET POSTS (Movies/Shows)
app.get("/api/posts", async (req, res) => {
  const { provider, filter, page } = req.query;
  if (!provider || !filter)
    return res.status(400).json({ error: "Provider and filter are required" });

  const module = await getProviderModule(provider, "posts");
  if (!module || !module.getPosts) {
    return res
      .status(404)
      .json({ error: "getPosts not found for this provider" });
  }

  try {
    const posts = await module.getPosts({
      filter,
      page: parseInt(page) || 1,
      providerValue: provider,
      providerContext: mockContext,
    });
    res.json(posts);
  } catch (error) {
    console.error(`getPosts error for ${provider}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// 3. GET META (Details)
app.get("/api/meta", async (req, res) => {
  const { provider, link } = req.query;
  if (!provider || !link)
    return res.status(400).json({ error: "Provider and link are required" });

  const module = await getProviderModule(provider, "meta");
  if (!module || !module.getMeta) {
    return res
      .status(404)
      .json({ error: "getMeta not found for this provider" });
  }

  try {
    const meta = await module.getMeta({
      link,
      providerContext: mockContext,
    });
    res.json(meta);
  } catch (error) {
    console.error(`getMeta error for ${provider}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// 4. GET EPISODES (For Series)
app.get("/api/episodes", async (req, res) => {
  const { provider, url } = req.query;
  if (!provider || !url)
    return res.status(400).json({ error: "Provider and url are required" });

  const module = await getProviderModule(provider, "episodes");
  if (!module || !module.getEpisodes) {
    return res
      .status(404)
      .json({ error: "getEpisodes not found for this provider" });
  }

  try {
    const episodes = await module.getEpisodes({
      url,
      providerContext: mockContext,
    });
    res.json(episodes);
  } catch (error) {
    console.error(`getEpisodes error for ${provider}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// 5. GET STREAM (Video URL)
app.get("/api/stream", async (req, res) => {
  const { provider, link, type } = req.query;
  if (!provider || !link)
    return res.status(400).json({ error: "Provider and link are required" });

  const module = await getProviderModule(provider, "stream");
  if (!module || !module.getStream) {
    return res
      .status(404)
      .json({ error: "getStream not found for this provider" });
  }

  try {
    const stream = await module.getStream({
      link,
      type: type || "movie",
      providerContext: mockContext,
    });
    res.json(stream);
  } catch (error) {
    console.error(`getStream error for ${provider}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// 6. SEARCH (Specific Provider(s) or All)
app.get("/api/search", async (req, res) => {
  const { providers, provider, query, page = 1 } = req.query;
  if (!query)
    return res.status(400).json({ error: "Search query is required" });

  const searchProvider = async (prov) => {
    let mod = await getProviderModule(prov, "search");
    if (!mod || !mod.getSearchPosts) {
      mod = await getProviderModule(prov, "posts");
    }

    if (mod && mod.getSearchPosts) {
      try {
        const results = await mod.getSearchPosts({
          searchQuery: query,
          page: parseInt(page),
          providerValue: prov,
          providerContext: mockContext,
        });
        // Attach providerId so the frontend knows where the result came from
        return results.map((item) => ({ ...item, providerId: prov }));
      } catch (err) {
        return [];
      }
    }
    return [];
  };

  try {
    let targetProviders = [];

    if (providers) {
      // 👇 Search ONLY the comma-separated list of installed providers
      targetProviders = providers.split(",");
    } else if (provider) {
      targetProviders = [provider];
    } else {
      // Fallback: Search all providers in dist/ if none specified
      const fs = require("fs");
      const distPath = path.join(__dirname, "dist");
      if (fs.existsSync(distPath)) {
        targetProviders = fs.readdirSync(distPath);
      }
    }

    const resultsArray = await Promise.all(targetProviders.map(searchProvider));
    const allResults = resultsArray.flat();

    // Deduplicate by link to avoid showing the same movie twice
    const uniqueResults = Array.from(
      new Map(allResults.map((item) => [item.link, item])).values(),
    );

    res.json(uniqueResults);
  } catch (error) {
    console.error("Search error:", error.message);
    res.status(500).json({ error: "Search failed" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🌉 =========================================`);
  console.log(`🚀 Vega Provider Bridge API is running!`);
  console.log(`💻 Local: http://localhost:${PORT}`);
  console.log(`📱 Mobile: http://<YOUR-COMPUTER-IP>:${PORT}`);
  console.log(`🌉 =========================================\n`);
});
