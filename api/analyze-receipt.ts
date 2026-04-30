import { GoogleGenAI, Type } from "@google/genai";
import * as admin from "firebase-admin";

// Initialize Firebase Admin for secure token verification
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.VITE_FIREBASE_PROJECT_ID
  });
}

// Schema for Gemini
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

let aiClient: GoogleGenAI | null = null;
function getAI() {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    aiClient = new GoogleGenAI({ apiKey: key });
  }
  return aiClient;
}

export default async function handler(req: any, res: any) {
  // CORS wrapper if needed, Vercel usually handles it for same-origin
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Verify auth token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing or invalid token" });
  }
  
  const token = authHeader.split(" ")[1];
  try {
    await admin.auth().verifyIdToken(token);
  } catch (error) {
    console.error("Token verification failed:", error);
    return res.status(401).json({ error: "Unauthorized: Token verification failed" });
  }

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
    return res.status(200).json(result);
  } catch (error) {
    console.error("AI Error:", error);
    return res.status(500).json({ error: "Failed to analyze image" });
  }
}
