import express, { Request, Response, NextFunction } from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import * as admin from "firebase-admin";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";

dotenv.config();

// Initialize Firebase Admin for secure token verification
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.VITE_FIREBASE_PROJECT_ID
  });
}

const AnalysisSchema = {
  type: Type.OBJECT,
  description: "Extracted sale details from a screenshot",
  properties: {
    items: {
      type: Type.ARRAY,
      description: "List of all products found in the screenshot or receipt",
      items: {
        type: Type.OBJECT,
        properties: {
          itemName: { type: Type.STRING, description: "Name/code of the item" },
          soldPrice: { type: Type.NUMBER, description: "Price the item was sold for" },
          trackingNumber: { type: Type.STRING, nullable: true, description: "Optional tracking number or courier code" }
        },
        required: ["itemName", "soldPrice"]
      }
    }
  },
  required: ["items"]
};

// Lazy initialization of the Gemini client
let aiClient: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      console.error("GEMINI_API_KEY environment variable is required");
      throw new Error("Missing Gemini key on server");
    }
    aiClient = new GoogleGenAI({ apiKey: key });
  }
  return aiClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Security Middleware
  app.use(helmet({
    contentSecurityPolicy: false, // Disabled for Vite HMR in development
    crossOriginEmbedderPolicy: false
  }));
  app.use(cors());

  // Rate Limiting: max 100 requests per 15 minutes per IP
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100, 
    message: { error: "Too many requests from this IP, please try again later." }
  });
  app.use("/api/", limiter);

  // Needed to parse large base64 JSON requests 
  app.use(express.json({ limit: '10mb' }));

  // Authentication Middleware
  const authenticate = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized: Missing or invalid token" });
    }
    
    const token = authHeader.split(" ")[1];
    try {
      const decodedToken = await admin.auth().verifyIdToken(token);
      // Optional: enforce that only ADMIN_EMAIL can use the APIs
      // if (decodedToken.email !== "yamannewtab@gmail.com") {
      //   return res.status(403).json({ error: "Forbidden: Admin access required" });
      // }
      (req as any).user = decodedToken;
      next();
    } catch (error) {
      console.error("Token verification failed:", error);
      return res.status(401).json({ error: "Unauthorized: Token verification failed" });
    }
  };

  // API Routes
  app.post("/api/analyze-receipt", authenticate, async (req, res) => {
    try {
      const { base64String, fileType, productsList } = req.body;
      
      const ai = getAI();
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: {
          parts: [
            { text: "Analyze this receipt or sale screenshot. Extract ALL products found. For each product, extract the item name (from: " + productsList + "), the total sold price, and any courier tracking code (like SPX or JNE). Return a JSON object containing an 'items' array." },
            { inlineData: { mimeType: fileType, data: base64String } }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: AnalysisSchema
        }
      });

      const result = JSON.parse(response.text || "{}");
      res.json(result);
    } catch (error: any) {
      console.error("AI Error:", error);
      res.status(500).json({ error: "Failed to analyze image: " + error?.message });
    }
  });

  app.post("/api/analyze-list", authenticate, async (req, res) => {
    try {
      const { textList, productsList } = req.body;
      
      const ai = getAI();
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: {
          parts: [
            { text: `Extract all sales records from the following text document. Each line generally represents a sale. 
Match the items mentioned to the closest valid product from this list: ${productsList}. 
If no explicit price is given, use 0. Also extract the tracking number (e.g., SPXID..., CM..., JX...).
Return a JSON array named "items".
TEXT:
${textList}
            ` }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: AnalysisSchema
        }
      });

      const result = JSON.parse(response.text || "{}");
      res.json(result);
    } catch (error: any) {
      console.error("AI Error parsing list:", error);
      res.status(500).json({ error: "Failed to analyze text list: " + error?.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
