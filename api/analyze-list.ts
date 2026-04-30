import { GoogleGenAI, Type } from "@google/genai";

// Schema for Gemini
const AnalysisSchema = {
  type: Type.OBJECT,
  description: "Extracted sale details from text list",
  properties: {
    items: {
      type: Type.ARRAY,
      description: "List of all products found in the text list",
      items: {
        type: Type.OBJECT,
        properties: {
          itemName: { type: Type.STRING, description: "Name/code of the item" },
          soldPrice: { type: Type.NUMBER, description: "Price the item was sold for, default to 0 if unknown" },
          trackingNumber: { type: Type.STRING, nullable: true, description: "Optional tracking number or courier code (e.g. SPXID...)" }
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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

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
    return res.status(200).json(result);
  } catch (error) {
    console.error("AI Error:", error);
    return res.status(500).json({ error: "Failed to analyze text list" });
  }
}
