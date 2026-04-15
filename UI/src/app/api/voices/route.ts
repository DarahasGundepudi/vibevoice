import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const voices = await prisma.clonedVoice.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ voices });
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  try {
    const formData = await req.formData();
    const name = formData.get("name") as string;
    const file = formData.get("file") as Blob;

    if (!name || !file) {
      return NextResponse.json({ error: "Missing name or file" }, { status: 400 });
    }

    // 1. Upload to Supabase Storage
    const fileExt = "wav"; // Defaulting to wav for VibeVoice compatibility
    const fileName = `${user.id}/${Date.now()}.${fileExt}`;
    const filePath = fileName; // Upload directly to the bucket root (bucket is already named 'voices')

    const { error: uploadError } = await supabaseAdmin.storage
      .from("voices")
      .upload(filePath, file, {
        contentType: file.type || "audio/wav",
        upsert: true
      });

    if (uploadError) {
      console.error("Supabase Upload Error:", uploadError);
      return NextResponse.json({ error: "Failed to upload to cloud storage" }, { status: 500 });
    }

    // 2. Get Public URL
    const { data: urlData } = supabaseAdmin.storage
      .from("voices")
      .getPublicUrl(filePath);

    const publicUrl = urlData.publicUrl;

    // 3. Save to Database
    const voice = await prisma.clonedVoice.create({
      data: {
        userId: user.id,
        name,
        sampleUrl: publicUrl,
        language: "en", // Default for now
      },
    });

    return NextResponse.json({ voice }, { status: 201 });
  } catch (err) {
    console.error("Voice creation error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
