import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json(
        { error: "Only PDF files are supported" },
        { status: 400 }
      );
    }

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Extract text from PDF - use require to bypass strict module resolution
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse/lib/pdf-parse.js");
    const pdfData = await pdfParse(buffer);

    // If pagerender returned empty, fall back to text extraction
    const text = pdfData.text || "";

    return NextResponse.json({
      text,
      pages: pdfData.numpages,
    });
  } catch (error) {
    console.error("PDF parse error:", error);
    // Return a helpful message so the user can paste manually
    return NextResponse.json(
      { error: "PDF parsing failed. Please paste your resume text manually.", text: "" },
      { status: 200 }
    );
  }
}
