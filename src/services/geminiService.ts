import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface ExtractedBookmark {
  title: string;
  page: number;
  level: number; // 0 for main chapter, 1 for section, etc.
}

export async function extractTOCFromImages(base64Images: string[]): Promise<ExtractedBookmark[]> {
  const model = "gemini-3-flash-preview";
  const BATCH_SIZE = 1; // Process 1 page at a time for maximum reliability
  const allBookmarks: ExtractedBookmark[] = [];

  for (let i = 0; i < base64Images.length; i += BATCH_SIZE) {
    const batch = base64Images.slice(i, i + BATCH_SIZE);
    const parts = batch.map(img => ({
      inlineData: {
        mimeType: "image/jpeg",
        data: img.split(',')[1] || img
      }
    }));

    // Add a small delay between requests to avoid rate limiting
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            ...parts,
            {
              text: `Extract the Table of Contents from this image. 
              Return a JSON array of objects, each with:
              - 'title' (string): The chapter or section title.
              - 'page' (integer): The page number shown in the TOC.
              - 'level' (integer): The hierarchy level. 0 for main chapters (e.g. Chapter 1), 1 for sections (e.g. 1.1), 2 for sub-sections (e.g. 1.1.1).
              
              Guidelines:
              - Only include meaningful chapters and sections.
              - If a page number is a range (e.g. 10-15), use the starting number.
              - Ignore dots, leaders, and page numbers that are clearly wrong.
              - Ensure the 'level' accurately reflects the visual hierarchy (indentation or numbering style).`
            }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              page: { type: Type.INTEGER },
              level: { type: Type.INTEGER }
            },
            required: ["title", "page", "level"]
          }
        }
      }
    });

    try {
      const text = response.text;
      const batchBookmarks = JSON.parse(text || "[]");
      allBookmarks.push(...batchBookmarks);
    } catch (e) {
      console.error("Failed to parse Gemini response for batch", i, e);
    }
  }

  return allBookmarks;
}
