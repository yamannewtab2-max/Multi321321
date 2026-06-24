import { GoogleGenAI, Type } from "@google/genai";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

if (!admin.apps?.length) {
  admin.initializeApp({
    projectId: process.env.VITE_FIREBASE_PROJECT_ID
  });
}

const db = getFirestore();

const CodeSchema = {
  type: Type.OBJECT,
  description: "Extracted tracking/courier codes from an image",
  properties: {
    codes: {
      type: Type.ARRAY,
      description: "List of all tracking/courier codes found in the image (e.g. SPXID..., CM..., JX...)",
      items: { type: Type.STRING }
    }
  },
  required: ["codes"]
};

let aiClient: GoogleGenAI | null = null;
function getAI() {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    aiClient = new GoogleGenAI({ apiKey: *** });
  }
  return aiClient;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing or invalid token" });
  }
  
  const token = authHeader.split(" ")[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const adminEmail = process.env.VITE_ADMIN_EMAIL || "yamannewtab@gmail.com";
    if (decodedToken.email !== adminEmail) {
      return res.status(403).json({ error: "Forbidden: Admin access required" });
    }
  } catch (error) {
    console.error("Token verification failed:", error);
    return res.status(401).json({ error: "Unauthorized: Token verification failed" });
  }

  try {
    const { base64String, fileType } = req.body;
    const ai = getAI();
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [
          { text: "Extract ALL tracking codes / courier codes from this image. Look for codes like SPXID..., CM..., JX..., JNE..., or any alphanumeric order/courier tracking numbers. Return ONLY the raw codes in a JSON array named 'codes'. Do NOT include product names or prices — only tracking codes." },
          { inlineData: { mimeType: fileType, data: base64String } }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: CodeSchema
      }
    });

    const result = JSON.parse(response.text || "{}");
    const rawCodes: string[] = result.codes || [];
    
    // Deduplicate and normalize
    const uniqueCodes = [...new Set(rawCodes.map((c: string) => c.trim()).filter((c: string) => c.length > 0))];
    
    if (uniqueCodes.length === 0) {
      return res.status(200).json({ found: [], notFound: [] });
    }

    // Check Firestore for each code
    // Firestore 'in' query max is 30 items per batch
    const existingTrackingNumbers = new Set<string>();
    
    for (let i = 0; i < uniqueCodes.length; i += 30) {
      const batch = uniqueCodes.slice(i, i + 30);
      const snapshot = await db.collection("sales")
        .where("trackingNumber", "in", batch)
        .get();
      for (const doc of snapshot.docs) {
        const tn = doc.data().trackingNumber?.trim();
        if (tn) existingTrackingNumbers.add(tn);
      }
    }

    const found: string[] = [];
    const notFound: string[] = [];
    for (const code of uniqueCodes) {
      if (existingTrackingNumbers.has(code)) {
        found.push(code);
      } else {
        notFound.push(code);
      }
    }

    return res.status(200).json({ found, notFound });
  } catch (error) {
    console.error("Code check error:", error);
    return res.status(500).json({ error: "Failed to check codes" });
  }
}
